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
   equip TEXT
  );
`);

let GG: any = {}; // [hash] = gen_group
let gen_group_id = 1;

const NAMES = JSON.parse(fs.readFileSync('names.json', 'utf8'))

const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, gen_group, hash_id, unit_config_name, ui_name, data, map_static, drops, equip, merged)
  VALUES
  (@map_type, @map_name, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @map_static, @drops, @equip, @merged )`);

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

function getMapName(filePath: string) {
  if (filePath.includes('MainField/')) {
    return 'Surface';
  } else if (filePath.includes('MinusField/')) {
    return 'Depths';
  } else if (filePath.includes('Sky/')) {
    return 'Sky';
  } else if (filePath.includes('DeepHole/')) {
    return 'DeepHole';
  } else if (filePath.includes('Cave/')) {
    return 'Cave';
  }
  console.log("Unknown Map Name:", filePath)
  process.exit(1)
}

function processBanc(filePath: string) {
  let doc: any = null;
  console.log("process Banc", filePath);
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

  for (const actor of doc.Actors) {
    let drops: any = [];
    let equip: any = [];
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
      }
      for (const tag of EQUIPS) {
        if (dyn[tag]) {
          equip.push(dyn[tag]);
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
    let ui_name = getName(actor.Gyaml);
    const isMerged = actor.Gyaml.includes('MergedActor');
    try {
      insertObj.run({
        map_type: 'Totk',
        map_name: map_name,
        gen_group: null,
        hash_id: actor.Hash.toString(),
        unit_config_name: actor.Gyaml,
        ui_name: ui_name,
        data: JSON.stringify(actor.Dynamic),
        drops: (drops.length > 0) ? JSON.stringify(drops) : null,
        equip: (equip.length > 0) ? JSON.stringify(equip) : null,
        map_static: (isStatic) ? 1 : 0,
        merged: (isMerged) ? 1 : 0,
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


db.transaction(() => processBancs())();
db.transaction(() => processBancsGG())();


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
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", tokenize="unicode61", map, actor, name, data);

    INSERT INTO objs_fts(rowid, map, actor, name, data)
    SELECT objid, map_type || '/' || map_name, unit_config_name, ui_name, data  FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
fs.renameSync('map.db.tmp', 'map.db');
