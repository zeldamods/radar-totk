import fs from 'fs';
import sqlite3 from 'better-sqlite3';
import path from 'path';
import yaml from 'js-yaml';

let parseArgs = require('minimist');
let argv = parseArgs(process.argv);
if (!argv.d) {
  console.log("Error: Must specify a path to directory with Banc extracted YAML files");
  console.log("       e.g. % ts-node build.ts -d path/to/Banc")
  process.exit(1);
}
const totkData = argv.d

const db = sqlite3('map.db.tmp');
db.pragma('journal_mode = WAL');


// hash_id is TEXT because the values is too big for sqlite to hold as an integer
db.exec(`
  CREATE TABLE objs (
   objid INTEGER PRIMARY KEY,
   map_type TEXT NOT NULL,
   map_name TEXT NOT NULL,
   gen_group INTEGER,
   hash_id TEXT UNIQUE,
   unit_config_name TEXT NOT NULL,
   ui_name TEXT NOT NULL,
   data JSON NOT NULL,
   map_static bool,
   merged bool,
   drops TEXT,
   equip TEXT,
   ui_drops TEXT,
   ui_equip TEXT
  );
`);

let GG: any = {}; // [hash] = gen_group
let gen_group_id = 1;

const NAMES = JSON.parse(fs.readFileSync('names.json', 'utf8'))

const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, gen_group, hash_id, unit_config_name, ui_name, data, map_static, drops, equip, merged, ui_drops, ui_equip)
  VALUES
  (@map_type, @map_name, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @map_static, @drops, @equip, @merged, @ui_drops, @ui_equip )`);

function getName(name: string) {
  if (name in NAMES) {
    return NAMES[name];
  }
  return name;
}

const ulType = new yaml.Type('!ul', {
  kind: 'scalar', instanceOf: Number,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});
const uType = new yaml.Type('!u', {
  kind: 'scalar', instanceOf: Number,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});

let schema = yaml.DEFAULT_SCHEMA.extend([ulType, uType]);

const EQUIPS = [
  "EquipmentUser_Bow",
  "EquipmentUser_Weapon",
  "EquipmentUser_Shield",
  "EquipmentUser_Tool",
  "Equipment_Attachment",
  "EquipmentUser_Attachment_Arrow",
  "EquipmentUser_Attachment_Weapon",
  "EquipmentUser_Attachment_Shield",
  "EquipArmorName1",
  "EquipmentUser_Helmet",
  "EquipmentUser_SubTool",
  "EquipWeaponType",
  "EquipmentUser_Accessory1",
  "EquipmentUser_Accessory2",
  "EquipmentUser_Accessory3",
];

export function pointToMapUnit(p: number[]) {
  const col = ((p[0] + 5000) / 1000) >>> 0;
  const row = ((p[2] + 4000) / 1000) >>> 0;
  return String.fromCharCode('A'.charCodeAt(0) + col)
    + '-'
    + String.fromCharCode('1'.charCodeAt(0) + row);
}


function getMapName(filePath: string) {
  // Almost everything, except MinusField must come before MainField
  //   as they are included in the MainField directory
  let level = "";
  if (filePath.includes('Sky/')) {
    level = 'Sky';
  } else if (filePath.includes('DeepHole/')) {
    level = 'DeepHole';
  } else if (filePath.includes('Cave/')) {
    level = 'Cave';
  } else if (filePath.includes('MinusField/')) {
    level = 'Depths';
  } else if (filePath.includes('MainField/')) {
    level = 'Surface';
  } else {
    console.log("Unknown Map Name:", filePath)
    process.exit(1)
  }
  //const quad = path.basename(filePath).split('.')[0].split('_').slice(-2, -1);
  let quad = "";
  const base = path.basename(filePath);
  const idx = base.indexOf('-');
  if (idx > 0) {
    quad = base.slice(idx - 1, idx + 2);
  } else {
    quad = 'Z-0';
  }
  return `${level}_${quad}`;
}

function processBanc(filePath: string) {
  let doc: any = null;
  try {
    doc = yaml.load(fs.readFileSync(filePath, 'utf-8'),
      { schema: schema }
    );
  } catch (e: any) {
    console.log("Error: ", e);
    process.exit(1);
  }
  const isStatic = filePath.includes('_Static');
  let map_name = getMapName(filePath)
  if (!doc.Actors) {
    return;
  }
  console.log("process Banc", map_name, (isStatic) ? "Static" : "Dynamic", filePath);

  for (const actor of doc.Actors) {
    let drops: any = [];
    let equip: any = [];
    let ui_drops: any = [];
    let ui_equip: any = [];
    if (actor.Dynamic) {
      const dyn = actor.Dynamic;
      dyn.Translate = actor.Translate;
      if (dyn.Drop__DropTable) {
        drops.push(2);
        drops.push(dyn.Drop__DropTable);
      }
      if (dyn.Drop__DropActor) {
        drops.push(1);
        drops.push(dyn.Drop__DropActor);
        let ui_drop_actor = getName(dyn.Drop__DropActor);
        if (ui_drop_actor != dyn.Drop__DropActor) {
          ui_drops.push(ui_drop_actor);
        }
      }
      for (const tag of EQUIPS) {
        if (dyn[tag] && dyn[tag] != '2' && dyn[tag] != '3') {
          equip.push(dyn[tag]);
          let ui_equip_actor = getName(dyn[tag]);
          if (ui_equip_actor != dyn[tag]) {
            ui_equip.push(ui_equip_actor);
          }
        }
      }
      for (const key of Object.keys(dyn)) {
        if (!EQUIPS.includes(key) && key.startsWith('Equip')) {
          console.log('Equip', key)
        }
      }
    } else {
      actor.Dynamic = { Translate: actor.Translate };
    }
    let zmap_name = map_name;
    if (zmap_name.includes('Z-0')) {
      const level = zmap_name.split('_')[0];
      if (actor.Translate) {
        const quad = pointToMapUnit(actor.Translate);
        zmap_name = `${level}_${quad}`
      } else {
        console.log(actor);
        zmap_name = `${level}`
      }
    }
    let ui_name = getName(actor.Gyaml);
    const isMerged = actor.Gyaml.includes('MergedActor');
    try {
      insertObj.run({
        map_type: 'Totk',
        map_name: zmap_name,
        gen_group: null,
        hash_id: actor.Hash.toString(),
        unit_config_name: actor.Gyaml,
        ui_name: ui_name,
        data: JSON.stringify(actor.Dynamic),
        drops: (drops.length > 0) ? JSON.stringify(drops) : null,
        equip: (equip.length > 0) ? JSON.stringify(equip) : null,
        map_static: (isStatic) ? 1 : 0,
        merged: (isMerged) ? 1 : 0,
        ui_drops: JSON.stringify(ui_drops),
        ui_equip: JSON.stringify(ui_equip),
      });
    } catch (e) {
      console.log("sqlite3 insert error", actor.Hash);
      console.log(e);
      process.exit(1)
    }

    if (actor.Links) {
      for (const link of actor.Links) {
        if (link.Src != actor.Hash) {
          console.log("src != hash", link.Src, actor.Hash);
        }
        let gg_dst = GG[link.Dst];
        let gg_src = GG[link.Src];
        if (!gg_dst && !gg_src) {
          GG[link.Dst] = gen_group_id;
          GG[link.Src] = gen_group_id;
          gen_group_id += 1;
        } else if (!gg_dst) {
          GG[link.Dst] = gg_src;
        } else if (!gg_src) {
          GG[link.Src] = gg_dst;
        } else if (gg_dst == gg_src) {
          true;
        } else if (gg_dst != gg_src) {
          for (const id of Object.keys(GG)) {
            if (GG[id] == gg_src) {
              GG[id] = gg_dst;
            }
          }
        }
      }
    }
  }
}


function processBancs() {
  const fields = ["MainField", "MinusField", "MainField/Sky", "MainField/Cave", "MainField/DeepHole"];
  for (const field of fields) {
    const dirPath = path.join(totkData, field);
    let files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.bcett.yml'))
        continue;
      let filePath = path.join(dirPath, file);
      processBanc(filePath);
    }
  }
}
function processBancsGG() {
  let stmt = db.prepare(`UPDATE objs SET gen_group = @gen_group where hash_id = @hash `);
  for (const hash of Object.keys(GG)) {
    stmt.run({ gen_group: GG[hash].toString(), hash: hash })
  }
  db.prepare('UPDATE objs SET gen_group = rowid+(select max(gen_group) from objs) where gen_group is null').run();
}

function processRecycleBox() {
  const fields = ['NormalStage/RecycleBox',
    'BossVehicle/RecycleBox',
    'MinusField/RecycleBox',
    'LargeDungeon/RecycleBox',
    'MainField/RecycleBox',
    'SmallDungeon/RecycleBox'
  ];
  for (const field of fields) {
    const dirPath = path.join(totkData, field)
    let files = fs.readdirSync(dirPath);
    let stmt = db.prepare('UPDATE objs SET equip = @equip, ui_equip = @ui_equip where hash_id = @hash_id');
    for (const file of files) {
      if (!file.endsWith('recyclebox.yml')) {
        continue;
      }
      let filePath = path.join(dirPath, file);
      console.log("process recyclebox: ", filePath)
      let doc: any = null;
      try {
        doc = yaml.load(fs.readFileSync(filePath, 'utf-8'),
          { schema: schema });
      } catch (e: any) {
        console.log("Error: ", e);
        process.exit(1);
      }
      for (const hash_id of Object.keys(doc)) {
        const box = doc[hash_id];
        let equip = [];
        let ui_equip = [];
        for (const item of box.Contents) {
          equip.push(item);
          const ui_name = getName(item);
          if (ui_name != item) {
            ui_equip.push(ui_name);
          }
        }
        if (equip.length > 0) {
          stmt.run({
            hash_id: hash_id,
            equip: JSON.stringify(equip),
            ui_equip: JSON.stringify(ui_equip),
          });
        }
      }
    }
  }
}

db.transaction(() => processBancs())();
db.transaction(() => processBancsGG())();
db.transaction(() => processRecycleBox())();

function createIndexes() {
  db.exec(`
    CREATE INDEX objs_map ON objs (map_type, map_name);
    CREATE INDEX objs_map_type ON objs (map_type);
    CREATE INDEX objs_hash_id ON objs (hash_id);
    CREATE INDEX objs_unit_config_name ON objs (unit_config_name);
  `);
}
console.log('creating indexes...');
createIndexes();


function createFts() {
  db.exec(`
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", tokenize="unicode61", map, actor, name, data, drops, ui_drops, equip, ui_equip, hash_id);

    INSERT INTO objs_fts(rowid, map, actor, name, data, drops, ui_drops, equip, ui_equip, hash_id )
    SELECT objid, map_type || '/' || map_name, unit_config_name, ui_name, data, drops, ui_drops, equip, ui_equip, hash_id FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
fs.renameSync('map.db.tmp', 'map.db');
