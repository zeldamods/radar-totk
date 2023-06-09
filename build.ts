import sqlite3 from 'better-sqlite3';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

let parseArgs = require('minimist');
let argv = parseArgs(process.argv);
if (!argv.d) {
  console.log("Error: Must specify a path to directory with Banc extracted YAML files");
  console.log("       e.g. % ts-node build.ts -d path/to/Banc")
  process.exit(1);
}
const totkData = argv.d

fs.rmSync('map.db.tmp', { force: true });
const db = sqlite3('map.db.tmp');
db.pragma('journal_mode = WAL');

class GenGroupIdGenerator {
  private nextId = 0;

  generateId() {
    return this.nextId++;
  }
}

const genGroupIdGenerator = new GenGroupIdGenerator();

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
   scale INTEGER,
   map_static bool,
   merged bool,
   drops TEXT,
   equip TEXT,
   ui_drops TEXT,
   ui_equip TEXT,
   korok_id TEXT,
   korok_type TEXT
  );

  CREATE TABLE ai_groups (
   id INTEGER PRIMARY KEY,
   map_type TEXT NOT NULL,
   map_name TEXT NOT NULL,
   hash_id TEXT UNIQUE,
   data TEXT NOT NULL
  );

  CREATE TABLE ai_group_references (
    id INTEGER PRIMARY KEY,
    ai_group_id INTEGER,
    object_id INTEGER,
    FOREIGN KEY(ai_group_id) REFERENCES ai_groups(id),
    FOREIGN KEY(object_id) REFERENCES objs(objid)
  );
  CREATE TABLE rails (
    hash_id TEXT UNIQUE,
    data JSON NOT NULL
  );
  CREATE TABLE drop_tables (
    unit_config_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    data JSON NOT NULL
  );
`);

const NAMES = JSON.parse(fs.readFileSync('names.json', 'utf8'))
const LOCATIONS = JSON.parse(fs.readFileSync('LocationMarker.json', 'utf8'))
const KOROKS = JSON.parse(fs.readFileSync('koroks_id.json', 'utf8'))
const DROP_TABLES = JSON.parse(fs.readFileSync('drop_tables.json', 'utf8'))

const DropTableDefault = "Default";
const DropActor = 1;
const DropTable = 2;


const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, gen_group, hash_id, unit_config_name, ui_name, data, scale, map_static, drops, equip, merged, ui_drops, ui_equip, korok_id, korok_type)
  VALUES
  (@map_type, @map_name, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @scale, @map_static, @drops, @equip, @merged, @ui_drops, @ui_equip, @korok_id, @korok_type )`);

const insertAiGroup = db.prepare(`INSERT INTO ai_groups
  (map_type, map_name, hash_id, data)
  VALUES
  (@map_type, @map_name, @hash_id, @data)`);

const insertAiGroupReference = db.prepare(`INSERT INTO ai_group_references
  (ai_group_id, object_id)
  VALUES
  (@ai_group_id, @object_id)
`);

const insertDrops = db.prepare(`INSERT INTO drop_tables (unit_config_name, table_name, data) VALUES (@unit_config_name, @table_name, @data)`);

const insertRail = db.prepare(`INSERT INTO rails (hash_id, data) VALUES (@hash_id, @data)`);

function getName(name: string) {
  if (name in NAMES) {
    return NAMES[name];
  }
  return name;
}

const ulType = new yaml.Type('!ul', {
  kind: 'scalar', instanceOf: Number,
  resolve: function (data: any) { return true; },
  construct: function (data: any) { return data; },
});
const uType = new yaml.Type('!u', {
  kind: 'scalar', instanceOf: Number,
  resolve: function (data: any) { return true; },
  construct: function (data: any) { return data; },
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


function getMapNameForOpenWorldStage(filePath: string) {
  // Almost everything, except MinusField must come before MainField
  //   as they are included in the MainField directory
  let level = "";
  if (filePath.includes('Sky/')) {
    level = 'Sky';
  } else if (filePath.includes('DeepHole/')) {
    level = 'DeepHole';
  } else if (filePath.includes('Cave/')) {
    level = 'Cave';
  } else if (filePath.includes('Castle/')) {
    level = 'Castle';
  } else if (filePath.includes('LargeDungeon/')) {
    level = 'LargeDungeon';
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

function parseHash(hash: string) {
  return '0x' + BigInt(hash).toString(16).padStart(16, '0');
}

function getKorokType(hideType: number | undefined, name: string) {
  if (name == 'KorokCarryProgressKeeper') {
    return 'Korok Friends';
  }
  if (hideType == undefined) {
    return "Rock Lift";
  }
  const korokTypes = ['<0-empty>',
    'Stationary Lights', 'Dive', 'Flower Trail', 'Goal Ring (Race)', 'Moving Lights',
    'Rock Pattern', 'Offering Plate', 'Pinwheel Balloons', 'Stationary Balloon', 'Hanging Acorn',
    'Land on Target', 'Provide Shelter', 'Repair Roof', '<14-empty>', 'Puzzle Blocks',
    '<16-empty>', 'Catch the Light', 'Touch the Target', 'Catch the Seed', 'Pull the Plug',
    '<21-empty>', '<22-empty>', 'Through the Roof', 'Boulder Stand', 'Ring the Bell'
  ];
  if (hideType < 1 || hideType > 25) {
    return undefined;
  }
  return korokTypes[hideType];
}

function processBanc(filePath: string, mapType: string, mapName: string) {
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
  if (!doc.Actors) {
    return;
  }
  console.log("process Banc", mapName, (isStatic) ? "Static" : "Dynamic", filePath);

  const genGroupByEntityId = new Map();
  if (doc.SimultaneousGroups) {
    for (const group of doc.SimultaneousGroups) {
      const groupId = genGroupIdGenerator.generateId();

      for (const entityIdStr of group) {
        const entityId = parseHash(entityIdStr);

        if (genGroupByEntityId.get(entityId) !== undefined) {
          throw Error("expected each entity to be in exactly one generation group");
        }
        genGroupByEntityId.set(entityId, groupId);

      }
    }
  }

  if (doc.Rails) {
    for (const rail of doc.Rails) {
      rail.Hash = parseHash(rail.Hash);
      for (const point of rail.Points) {
        point.Hash = parseHash(point.Hash);
        if (point.Connections) {
          for (const connection of point.Connections) {
            connection.RailHash = parseHash(connection.RailHash);
          }
        }
      }
      insertRail.run({ hash_id: rail.Hash, data: JSON.stringify(rail) });
    }
  }

  const aiGroupsByEntityId: Map<String, any[]> = new Map();
  for (const group of (doc.AiGroups || [])) {
    const result = insertAiGroup.run({
      map_type: mapType,
      map_name: mapName,
      hash_id: parseHash(group.Hash),
      data: JSON.stringify(group),
    });

    const aiGroupId = result.lastInsertRowid;

    for (const reference of group.References) {
      if (reference.Reference === undefined) {
        continue;
      }

      const entityId = parseHash(reference.Reference);
      if (aiGroupsByEntityId.get(entityId) === undefined) {
        aiGroupsByEntityId.set(entityId, []);
      }
      aiGroupsByEntityId.get(entityId)!.push(aiGroupId);
    }
  }

  for (const actor of doc.Actors) {
    let ui_name = getName(actor.Gyaml);

    let drops: any = [];
    let equip: any = [];
    let ui_drops: any = [];
    let ui_equip: any = [];
    actor.Hash = parseHash(actor.Hash);
    if (actor.Dynamic) {
      const dyn = actor.Dynamic;
      if (dyn.Drop__DropTable) {
        drops.push(DropTable);
        drops.push(dyn.Drop__DropTable);
      }
      if (dyn.Drop__DropActor) {
        drops.push(DropActor);
        drops.push(dyn.Drop__DropActor);
        let ui_drop_actor = getName(dyn.Drop__DropActor);
        if (ui_drop_actor != dyn.Drop__DropActor) {
          ui_drops.push(ui_drop_actor);
        }

        const attach = dyn.Drop__DropActor_Attachment
        if (attach) {
          drops.push(attach);
          let ui_drop_actor = getName(attach);
          if (ui_drop_actor != attach) {
            ui_drops.push(ui_drop_actor);
          }
        }
      }
      // If DropTable and DropActor do not exist and an blank drop exists
      //   set the DropTable name to as 'Default'
      if (!dyn.Drop__DropTable && !dyn.Drop__DropActor) {
        if (actor.Gyaml in DROP_TABLES) {
          for (const table of DROP_TABLES[actor.Gyaml]) {
            if (table.DropTableName == "") {
              drops.push(DropTable);
              drops.push(DropTableDefault);
            }
          }
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
      if (dyn.Location && dyn.Location in LOCATIONS) {
        ui_name += ' ' + LOCATIONS[dyn.Location];
      }
    }

    if (mapType === "Totk" && mapName.includes('Z-0')) {
      const level = mapName.split('_')[0];
      if (actor.Translate) {
        const quad = pointToMapUnit(actor.Translate);
        mapName = `${level}_${quad}`
      } else {
        console.log(actor);
        mapName = `${level}`
      }
    }
    if (actor.Phive?.Placement?.ID) {
      actor.Phive.Placement.ID = parseHash(actor.Phive.Placement.ID);
    }
    if (actor.Links) {
      for (const link of actor.Links) {
        link.Dst = parseHash(link.Dst);
        link.Src = parseHash(link.Src);
      }
    }
    if (actor.Rails) {
      for (const rail of actor.Rails) {
        rail.Dst = parseHash(rail.Dst);
      }
    }

    const isMerged = actor.Gyaml.includes('MergedActor');

    let genGroup = genGroupByEntityId.get(actor.Hash);
    if (genGroup === undefined) {
      genGroup = genGroupIdGenerator.generateId();
    }
    let korok_id = undefined;
    let korok_type = undefined;
    if (actor.Hash in KOROKS) {
      korok_id = KOROKS[actor.Hash].id;
      korok_type = getKorokType(actor.Dynamic?.HideType, actor.Gyaml);
    }

    try {
      const result = insertObj.run({
        map_type: mapType,
        map_name: mapName,
        gen_group: genGroup,
        hash_id: actor.Hash,
        unit_config_name: actor.Gyaml,
        ui_name: ui_name,
        data: JSON.stringify(actor),
        scale: actor.Dynamic?.IsLevelSensorTarget ? 1 : 0,
        drops: (drops.length > 0) ? JSON.stringify(drops) : null,
        equip: (equip.length > 0) ? JSON.stringify(equip) : null,
        map_static: (isStatic) ? 1 : 0,
        merged: (isMerged) ? 1 : 0,
        ui_drops: JSON.stringify(ui_drops),
        ui_equip: JSON.stringify(ui_equip),
        korok_id: (korok_id) ? korok_id : null,
        korok_type: (korok_type) ? korok_type : null,
      });

      const objid = result.lastInsertRowid;

      for (const aiGroupId of (aiGroupsByEntityId.get(actor.Hash) || [])) {
        insertAiGroupReference.run({
          ai_group_id: aiGroupId,
          object_id: objid,
        });
      }
    } catch (e) {
      console.log("sqlite3 insert error", actor.Hash);
      console.log(e);
      process.exit(1)
    }
  }
}


function processBancs() {
  const fields = ["MainField", "MinusField", "MainField/Sky", "MainField/Cave", "MainField/DeepHole", "MainField/Castle", "MainField/LargeDungeon"];
  for (const field of fields) {
    const dirPath = path.join(totkData, field);
    let files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.bcett.yml'))
        continue;
      let filePath = path.join(dirPath, file);

      const mapName = getMapNameForOpenWorldStage(filePath);
      processBanc(filePath, "Totk", mapName);
    }
  }

  for (const mapType of ["SmallDungeon", "LargeDungeon", "NormalStage"]) {
    const dirPath = path.join(totkData, mapType);
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.bcett.yml'))
        continue;

      const filePath = path.join(dirPath, file);
      const mapName = file
        .replace(".bcett.yml", "")
        .replace("_Static", "")
        .replace("_Dynamic", "");
      processBanc(filePath, mapType, mapName);
    }
  }
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
            hash_id: parseHash(hash_id),
            equip: JSON.stringify(equip),
            ui_equip: JSON.stringify(ui_equip),
          });
        }
      }
    }
  }
}
function processDropTables() {
  for (const actor of Object.keys(DROP_TABLES)) {
    for (const data of DROP_TABLES[actor]) {
      let table_name = data.DropTableName;
      if (table_name == "") {
        table_name = DropTableDefault;
      }
      insertDrops.run({ unit_config_name: actor, table_name: table_name, data: JSON.stringify(data) });
    }
  }
}

db.transaction(() => processDropTables())();
db.transaction(() => processBancs())();
db.transaction(() => processRecycleBox())();

function createIndexes() {
  db.exec(`
    CREATE INDEX objs_map ON objs (map_type, map_name);
    CREATE INDEX objs_map_type ON objs (map_type);
    CREATE INDEX objs_hash_id ON objs (hash_id);
    CREATE INDEX objs_unit_config_name ON objs (unit_config_name);
    CREATE INDEX ai_group_references__object_id ON ai_group_references (object_id);
    CREATE INDEX ai_group_references__ai_group_id ON ai_group_references (ai_group_id);
  `);
}
console.log('creating indexes...');
createIndexes();


function createFts() {
  db.exec(`
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", tokenize="unicode61", map, actor, name, data, scale, drops, ui_drops, equip, ui_equip, hash_id, korok_id, korok_type);

    INSERT INTO objs_fts(rowid, map, actor, name, data, scale, drops, ui_drops, equip, ui_equip, hash_id, korok_id, korok_type )
    SELECT objid, map_type || '/' || map_name, unit_config_name, ui_name, data, scale, drops, ui_drops, equip, ui_equip, hash_id, korok_id, korok_type FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
fs.renameSync('map.db.tmp', 'map.db');
