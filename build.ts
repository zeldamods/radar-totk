import sqlite3 from 'better-sqlite3';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import { Beco } from './beco';

let parseArgs = require('minimist');
let argv = parseArgs(process.argv);
if (!argv.d || !argv.b || !argv.e) {
  console.log("Error: Must specify paths to directories with ");
  console.log("          -d Banc extracted YAML files");
  console.log("          -b field map area beco files");
  console.log("          -e Ecosystem json files");
  console.log("       e.g. % ts-node build.ts -d path/to/Banc -b path/to/beco -e path/to/Ecosystem")
  process.exit(1);
}
const totkData = argv.d
const becoPath = argv.b;
const ecoPath = argv.e;

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
   ui_map TEXT NOT NULL,
   gen_group INTEGER,
   hash_id TEXT UNIQUE,
   unit_config_name TEXT NOT NULL,
   ui_name TEXT NOT NULL,
   data JSON NOT NULL,
   fieldarea TEXT,
   region TEXT,
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
    object_id INTEGER UNIQUE,
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
const DUNGEONS = JSON.parse(fs.readFileSync('Dungeon.json', 'utf8'))

const DropTableDefault = "Default";
const DROP_TYPE_ACTOR = "Actor";
const DROP_TYPE_TABLE = "Table";

const BecoGround = new Beco(path.join(becoPath, 'Ground.beco'));
const BecoMinus = new Beco(path.join(becoPath, 'MinusField.beco'));
const BecoSky = new Beco(path.join(becoPath, 'Sky.beco'));
const BecoCave = new Beco(path.join(becoPath, 'Cave.beco'));
const BecoTower = new Beco(path.join(ecoPath, 'MapTower.beco'));

const TowerNames: { [key: string]: string } = {
  1: "Lookout Landing",
  2: "Lindor's Brow",
  3: "Pikida Stonegrove",
  4: "Eldin Canyon",
  5: "Ulri Mountain",
  6: "Sahasra Slope",
  7: "Upland Zorana",
  8: "Hyrule Field",
  9: "Gerudo Canyon",
  10: "Gerudo Highlands",
  11: "Rabella Wetlands",
  12: "Thyphlo Ruins",
  13: "Popla Foothills",
  14: "Mount Lanayru",
  15: "Rospro Pass",
};

// Should probably be yaml not json for consistency
const Ecosystem = Object.fromEntries(['Cave', 'Ground', 'MinusField', 'Sky'].map(name => {
  return [name, JSON.parse(fs.readFileSync(path.join(ecoPath, `${name}.ecocat.json`), 'utf8')).RootNode];
}));

const MapPctTmp = JSON.parse(fs.readFileSync('map_pct.json', 'utf8'))
let MapPct: { [key: string]: any } = {};
for (const kind of Object.keys(MapPctTmp)) {
  for (const entry of MapPctTmp[kind]) {
    for (const hash_id of entry.hash_id) {
      MapPct[hash_id] = entry;
      MapPct[hash_id].kind = kind;
    }
  }
}

const ShopData = JSON.parse(fs.readFileSync(path.join(ecoPath, 'shop_data.json'), 'utf-8'))

const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, ui_map, gen_group, hash_id, unit_config_name, ui_name, data, fieldarea, region, scale, map_static, drops, equip, merged, ui_drops, ui_equip, korok_id, korok_type)
  VALUES
  (@map_type, @map_name, @ui_map, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @fieldarea, @region, @scale, @map_static, @drops, @equip, @merged, @ui_drops, @ui_equip, @korok_id, @korok_type )`);

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

function getEcosystemArea(name: string, num: number) {
  if (Ecosystem[name][num].AreaNumber == num) {
    return Ecosystem[name][num];
  }
  for (const area of Ecosystem[name]) {
    if (area.AreaNumber == num) {
      return area;
    }
  }
  return null;
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
  // Note: See below for some Hanging Acorn transmogified into Acron in a Hole
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
    if (filePath.endsWith('.yml'))
      doc = yaml.load(fs.readFileSync(filePath, 'utf-8'),
        { schema: schema }
      );
    if (filePath.endsWith('.json'))
      doc = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
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

    let drops: any = {};
    let equip: any = [];
    let ui_drops: any = [];
    let ui_equip: any = [];
    actor.Hash = parseHash(actor.Hash);
    if (actor.Dynamic) {
      const dyn = actor.Dynamic;
      if (dyn.Drop__DropTable) {
        drops = { type: DROP_TYPE_TABLE, value: [dyn.Drop__DropTable] };
      }
      if (dyn.Drop__DropActor) {
        drops = { type: DROP_TYPE_ACTOR, value: [dyn.Drop__DropActor] }
        let ui_drop_actor = getName(dyn.Drop__DropActor);
        if (ui_drop_actor != dyn.Drop__DropActor) {
          ui_drops.push(ui_drop_actor);
        }

        const attach = dyn.Drop__DropActor_Attachment
        if (attach) {
          drops.value.push(attach);
          let ui_drop_actor = getName(attach);
          if (ui_drop_actor != attach) {
            ui_drops.push(ui_drop_actor);
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
        if (dyn.Location.startsWith('Dungeon')) {
          dyn.ShrineSubtitle = DUNGEONS[`${dyn.Location}_sub`]
        }
      }
      for (const k of ["", "2", "3"]) {
        const key = `CraftSignboardReward${k}`
        if (dyn[key]) {
          let ui_reward = getName(dyn[key])
          if (ui_reward != dyn[key]) {
            actor[`${key}_ui`] = ui_reward
          }
        }
      }
    }

    // If DropTable and DropActor do not exist and an blank drop exists
    //   set the DropTable name to as 'Default'
    if (Object.keys(drops).length == 0) {
      if (actor.Gyaml in DROP_TABLES) {
        for (const table of DROP_TABLES[actor.Gyaml]) {
          if (table.DropTableName == "") {
            drops = { type: DROP_TYPE_TABLE, value: [DropTableDefault] };
          }
        }
      }
    }

    if (actor.Gyaml == 'Npc_MinusFieldGhost_000') {
      const num = BecoMinus.getCurrentAreaNum(actor.Translate[0], actor.Translate[2]);
      const area = getEcosystemArea('MinusField', num);
      let weapon_type = actor.Dynamic?.HoldingWeaponType || 1;
      let weapons = []
      if (weapon_type == 1) {
        // Royal Broadsword ( 0x83ba246d992d663b)
        // Eightfold Blade (  0x70f7cb89ab7052e0)
        weapons = area.NotDecayedSmallSwordList;
      } else if (weapon_type == 2) {
        // Royal Guards Claymore ( 0x0a73b302f59153b7)
        // Traveler's Claymore ( 0xec225a9dfda4679e)
        weapons = area.NotDecayedLargeSwordList;
      } else if (weapon_type == 3) {
        // Knight's Halberd ( 0x0cde450be4231a97)
        // Travelers Spear (  0x0e4718a9b20afa93)
        weapons = area.NotDecayedSpearList;
      }
      const names = weapons.map((weapon: any) => weapon.name);
      equip.push(...names);
      ui_equip.push(...names.map((name: string) => getName(name)));
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
    if (actor.Hash in MapPct) {
      actor.MapPct = {
        category: MapPct[actor.Hash].kind,
        flag: MapPct[actor.Hash].flag,
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
    let fieldarea = null
    let region = null
    const uiMap = [mapType, mapName];
    if (mapType.startsWith('MinusField') || mapName.includes("LargeDungeonFire")) {
      uiMap.push('depths');
      fieldarea = 'Depths' + BecoMinus.getCurrentAreaNum(actor.Translate[0], actor.Translate[2]).toString();
    } else if (mapType.startsWith('MainField')) {
      if (mapName.startsWith('DeepHole')) {
        uiMap.push('chasm');
      }
      else if (!mapName.includes('__')) {
        uiMap.push('surface');
      }
      if (mapName.startsWith("Sky__") ||
        mapName.includes("LargeDungeonWater") ||
        mapName.includes("DragonBattleAndZeldaCatch") ||
        mapName.includes("LargeDungeonWind")) {
        fieldarea = 'Sky' + BecoSky.getCurrentAreaNum(actor.Translate[0], actor.Translate[2]).toString();
      } else if (mapName.startsWith("Cave__") || mapName.startsWith("DeepHole__")) {
        fieldarea = 'Cave' + BecoCave.getCurrentAreaNum(actor.Translate[0], actor.Translate[2]).toString();
      } else if (mapName.length == 3 ||
        mapName.startsWith("Castle__") ||
        mapName.includes("LargeDungeonThunder")) { // A-1, ...
        fieldarea = 'Surface' + BecoGround.getCurrentAreaNum(actor.Translate[0], actor.Translate[2]).toString();
        region = TowerNames[BecoTower.getCurrentAreaNum(actor.Translate[0], actor.Translate[2])];
      } else if (mapName.startsWith("_DistanceView")) {
        if (filePath.includes("MainField")) {
          fieldarea = 'Surface0'
        } else if (filePath.includes("MainField")) {
          fieldarea = 'Depths0'
        }
      } else if (mapName == "Merchants") {
      } else {
        console.log("field area not defined", mapName, mapType);
        process.exit(-1)
      }
    }

    if (ShopData[actor.Gyaml])
      actor.ShopData = ShopData[actor.Gyaml]
    if (actor.Gyaml == "MiasmaSwarm") {
      actor.ui_name_alt = "Gloom Spawn"
    }
    if (actor.Gyaml == "Npc_MinusFieldGhost_000") {
      actor.ui_name_alt = "Spectral Figure Pristine"
    }

    try {
      const result = insertObj.run({
        map_type: mapType,
        map_name: mapName,
        ui_map: uiMap.join(' '),
        gen_group: genGroup,
        hash_id: actor.Hash,
        unit_config_name: actor.Gyaml,
        ui_name: ui_name,
        data: JSON.stringify(actor),
        fieldarea: fieldarea,
        region: region,
        scale: actor.Dynamic?.IsLevelSensorTarget ? 1 : 0,
        drops: (Object.keys(drops).length > 0) ? JSON.stringify(drops) : null,
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
  const fields = ["MainField", "MinusField", "MainField/Sky", "MainField/Cave", "MainField/DeepHole", "MainField/Castle", "MainField/LargeDungeon", "MinusField/LargeDungeon"];
  for (const field of fields) {
    const dirPath = path.join(totkData, field);
    let files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.bcett.yml'))
        continue;
      let filePath = path.join(dirPath, file);

      const fieldParts = field.split("/");
      let mapName = file
        .replace(".bcett.yml", "")
        .replace("_Static", "")
        .replace("_Dynamic", "");
      const mapType = fieldParts[0];
      if (fieldParts.length == 2) {
        mapName = `${fieldParts[1]}__${mapName} `;
      }
      processBanc(filePath, mapType, mapName);
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

  processBanc(path.join(ecoPath, 'merchants.json'), 'MainField', "Merchants")
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
db.transaction(() => {
  console.log("Setting Acorn in a Hole Korok Type...");
  // "Acorn in a Hole" are "Hanging Acorn" with a Obj_KorokPotFixedVine_A_01
  db.exec(`update objs set korok_type = 'Acorn in a Hole'
   where korok_type = 'Hanging Acorn' and gen_group in
   (select gen_group from objs where unit_config_name = 'Obj_KorokPotFixedVine_A_01' )
`);
})();
db.transaction(() => {
  console.log("Adding AILogic path to data.Logic...");
  db.exec(`
update objs set data = json_insert(data, '$.AILogic', c.logic)
from (select objs.objid, json_extract(ai_groups.data, '$.Logic') as logic from objs
       join ai_group_references on ai_group_references.object_id = objs.objid
       join ai_groups on ai_group_references.ai_group_id = ai_groups.id
) as c where c.objid = objs.objid`);
})();

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
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", tokenize="unicode61", map, actor, name, data, fieldarea, region, scale, drops, ui_drops, equip, ui_equip, hash_id, korok_id, korok_type);

    INSERT INTO objs_fts(rowid, map, actor, name, data, fieldarea, region, scale, drops, ui_drops, equip, ui_equip, hash_id, korok_id, korok_type )
    SELECT objid, ui_map, unit_config_name, ui_name, data, fieldarea, region, scale, drops, ui_drops, equip, ui_equip, hash_id, korok_id, korok_type FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
fs.renameSync('map.db.tmp', 'map.db');
