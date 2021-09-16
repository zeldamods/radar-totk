import CRC32 from 'crc-32';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'better-sqlite3';

const beco = require('./beco');

const yaml = require('js-yaml');

import { PlacementMap, PlacementObj, PlacementLink, ResPlacementObj } from './app/PlacementMap';
import * as util from './app/util';

let parseArgs = require('minimist');

let argv = parseArgs(process.argv);

if (!argv.a) {
  console.log("Error: Must specify a path to directory with ActorLink and DropTable YAML files");
  console.log("       e.g. % ts-node build.ts -a ../botw/Actor")
  console.log("       YAML data files are available from https://github.com/leoetlino/botw");
  process.exit(1);
}
const botwData = argv.a;


const actorinfodata = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'ActorInfo.product.json'), 'utf8'));

const names: { [actor: string]: string } = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'names.json'), 'utf8'));
const getUiName = (name: string) => names[name] || name;
const locationMarkerTexts: { [actor: string]: string } = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'text', 'StaticMsg', 'LocationMarker.json'), 'utf8'));
const dungeonTexts: { [actor: string]: string } = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'text', 'StaticMsg', 'Dungeon.json'), 'utf8'));

const mapTower = new beco.Beco(path.join(util.APP_ROOT, 'content', 'ecosystem', 'MapTower.beco'));
// Tower Names taken from Messages/Msg_USen.product.sarc/StaticMsg/LocationMarker.msyt Tower01 - Tower15
const towerNames = ["Hebra", "Tabantha", "Gerudo", "Wasteland", "Woodland",
  "Central", "Great Plateau", "Dueling Peaks", "Lake",
  "Eldin", "Akkala", "Lanayru", "Hateno", "Faron", "Ridgeland"];
const fieldArea = new beco.Beco(path.join(util.APP_ROOT, 'content', 'ecosystem', 'FieldMapArea.beco'));

// Create Special tags for YAML: !obj, !list, !io, !str64
const objType = new yaml.Type('!obj', {
  kind: 'mapping', instanceOf: Object,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});
const listType = new yaml.Type('!list', {
  kind: 'mapping', instanceOf: Object,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});
const ioType = new yaml.Type('!io', {
  kind: 'mapping', instanceOf: Object,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});
const str64Type = new yaml.Type('!str64', {
  kind: 'scalar', instanceOf: String,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});

// Add Special Tags to the Default schema (to facilitate reading)
let schema = yaml.DEFAULT_SCHEMA.extend([objType, listType, ioType, str64Type]);

function readYAML(filePath: string) {
  let doc: any = null;
  try {
    doc = yaml.load(fs.readFileSync(filePath, 'utf-8'), { schema: schema });
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
  return doc;
}

function getDropTableNameFromActorLinkFile(doc: { [key: string]: any }): string | null {
  if ('DropTableUser' in doc.param_root.objects.LinkTarget) {
    let dropTableUser = doc.param_root.objects.LinkTarget.DropTableUser;
    return dropTableUser;
  }
  return null;
}
function getTagsFromActorLinkFile(doc: { [key: string]: any }): string[] | null {
  if ('Tags' in doc.param_root.objects) {
    let tags = doc.param_root.objects.Tags;
    return Object.values(tags);
  }
  return null;
}

function readDropTableFile(file: string) {
  let doc = readYAML(file)
  let tables: any = Object.keys(doc.param_root.objects)
    .filter(key => key != 'Header')
    .map(key => {
      let dropTable = doc.param_root.objects[key];
      let items: { [key: string]: any } = {};
      for (var i = 1; i <= dropTable.ColumnNum; i++) {
        let itemName = `ItemName${String(i).padStart(2, '0')}`;
        let itemProb = `ItemProbability${String(i).padStart(2, '0')}`;
        items[dropTable[itemName]] = dropTable[itemProb];
      }
      let data = {
        items: items,
        repeat_num: [dropTable.RepeatNumMin, dropTable.RepeatNumMax],
      };
      return { name: key, data: data };
    });
  return tables;
}

function readDropTablesByName(table: string) {
  return readDropTableFile(path.join(botwData, 'DropTable', `${table}.drop.yml`));
}

function readDropTables(lootTables: { [key: string]: string }) {
  let data: any[] = [];
  Object.keys(lootTables)
    .filter(name => lootTables[name] != "Dummy") // Ignore empty Dummy tables
    .forEach(name => {
      let tables = readDropTablesByName(lootTables[name]);
      tables.forEach((table: any) => table.actor_name = name); // Matches unit_config_name in table objs
      data.push(...tables);
    });
  return data;
}
function readYAMLData(): [any[], { [key: string]: string[] }] {
  let itemTags: { [key: string]: string[] } = {};
  let lootTables: { [key: string]: string } = {};

  let dirPath = path.join(botwData, 'ActorLink');
  let files = fs.readdirSync(dirPath);
  files.forEach(file => {
    let actorName = path.basename(file, '.yml'); // ==> UnitConfigName
    let filePath = path.join(botwData, 'ActorLink', file);
    let doc = readYAML(filePath);
    let tableName = getDropTableNameFromActorLinkFile(doc);
    if (tableName) {
      lootTables[actorName] = tableName;
    }
    let tags = getTagsFromActorLinkFile(doc);
    if (tags) {
      itemTags[actorName] = tags;
    }
  });

  let dropData: any[] = readDropTables(lootTables);
  return [dropData, itemTags];
}

let [dropData, itemTags] = readYAMLData();

const db = sqlite3('map.db.tmp');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE objs (
   objid INTEGER PRIMARY KEY,
   map_type TEXT NOT NULL,
   map_name TEXT NOT NULL,
   map_static BOOL,
   gen_group INTEGER,
   hash_id INTEGER,
   unit_config_name TEXT NOT NULL,
   ui_name TEXT NOT NULL,
   data JSON NOT NULL,
   one_hit_mode BOOL DEFAULT 0,
   last_boss_mode BOOL DEFAULT 0,
   hard_mode BOOL DEFAULT 0,
   disable_rankup_for_hard_mode BOOL DEFAULT 0,
   scale INTEGER DEFAULT 0,
   sharp_weapon_judge_type INTEGER DEFAULT 0,
   'drop' JSON,
   equip JSON,
   ui_drop TEXT,
   ui_equip TEXT,
   messageid TEXT,
   region TEXT NOT NULL,
   field_area INTEGER,
   spawns_with_lotm BOOL
  );
`);

db.exec(`
   CREATE TABLE drop_table (
     actor_name TEXT NOT NULL,
     name TEXT NOT NULL,
     data JSON
  );
`);


const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, map_static, gen_group, hash_id, unit_config_name, ui_name, data, one_hit_mode, last_boss_mode, hard_mode, disable_rankup_for_hard_mode, scale, sharp_weapon_judge_type, 'drop', equip, ui_drop, ui_equip, messageid, region, field_area, spawns_with_lotm)
  VALUES
  (@map_type, @map_name, @map_static, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @one_hit_mode, @last_boss_mode, @hard_mode, @disable_rankup_for_hard_mode, @scale, @sharp_weapon_judge_type, @drop, @equip, @ui_drop, @ui_equip, @messageid, @region, @field_area, @spawns_with_lotm)`);

function getActorData(name: string) {
  const h = CRC32.str(name) >>> 0;
  const hashes = actorinfodata['Hashes'];
  let a = 0, b = hashes.length - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    if (hashes[m] < h)
      a = m + 1;
    else if (hashes[m] > h)
      b = m - 1;
    else
      return actorinfodata['Actors'][m];
  }
  return null;
}

function isFlag4Actor(name: string) {
  if (name == 'Enemy_GanonBeast')
    return false;
  const info = getActorData(name);
  for (const x of ['Enemy', 'GelEnemy', 'SandWorm', 'Prey', 'Dragon', 'Guardian']) {
    if (info['profile'] == x)
      return true;
  }
  if (info['profile'].includes('NPC'))
    return true;
  return false;
}

function shouldSpawnObjForLastBossMode(obj: PlacementObj) {
  const name: string = obj.data.UnitConfigName;
  if (isFlag4Actor(name))
    return false;
  if (name == 'Enemy_Guardian_A')
    return false;
  if (name.includes('Entrance') || name.includes('WarpPoint') || name.includes('Terminal'))
    return false;
  return true;
}

function objGetUiName(obj: PlacementObj) {
  if (obj.data.UnitConfigName === 'LocationTag') {
    const id = obj.data['!Parameters'].MessageID;
    const locationName = locationMarkerTexts[id] || dungeonTexts[id];
    let s = `Location: ${locationName}`;
    const dungeonSub = dungeonTexts[id + '_sub'];
    if (dungeonSub)
      s += ' - ' + dungeonSub;
    return s;
  }
  return getUiName(obj.data.UnitConfigName);
}

function objGetDrops(params: any) {
  if (params.DropActor)
    return [1, params.DropActor];
  if (!params.DropActor && params.DropTable && params.DropTable != 'Normal')
    return [2, params.DropTable];
  return null;
}

function objGetUiDrops(params: any) {
  const info: string[] = [];
  if (params.DropActor)
    info.push(getUiName(params.DropActor));
  else if (params.DropTable && params.DropTable != 'Normal')
    info.push('Table:' + params.DropTable);
  return info.join('|');
}

function objGetEquipment(params: any) {
  const info: string[] = [];
  for (const prop of ['EquipItem1', 'EquipItem2', 'EquipItem3', 'EquipItem4', 'EquipItem5', 'RideHorseName']) {
    if ((prop in params) && params[prop] != 'Default')
      info.push(params[prop]);
  }
  if (params['ArrowName'] && params['ArrowName'] != 'NormalArrow') {
    info.push(params['ArrowName']);
  }
  return info;
}

function objGetUiEquipment(params: any) {
  return objGetEquipment(params).map(getUiName).join(', ');
}

function processMap(pmap: PlacementMap, isStatic: boolean): void {
  process.stdout.write(`processing ${pmap.type}/${pmap.name} (static: ${isStatic})`);
  const hashIdToObjIdMap: Map<number, any> = new Map();

  const genGroups: Map<number, PlacementObj[]> = new Map();
  const genGroupSkipped: Map<number, boolean> = new Map();
  for (const obj of pmap.getObjs()) {
    if (!genGroups.has(obj.genGroupId))
      genGroups.set(obj.genGroupId, []);
    genGroups.get(obj.genGroupId)!.push(obj);
  }
  for (const [id, genGroup] of genGroups.entries())
    genGroupSkipped.set(id, genGroup.some(o => !shouldSpawnObjForLastBossMode(o)));

  for (const obj of pmap.getObjs()) {
    const params = obj.data['!Parameters'];

    let scale = params ? params.LevelSensorMode : 0;
    if (!obj.data.UnitConfigName.startsWith('Weapon_') && !obj.data.UnitConfigName.startsWith('Enemy_'))
      scale = null;

    let area = -1;
    if (pmap.type == 'MainField') {
      area = fieldArea.getCurrentAreaNum(obj.data.Translate[0], obj.data.Translate[2]);
    }
    let lotm = false;
    let objTags = itemTags[obj.data.UnitConfigName];
    if (area == 64 && objTags) {
      lotm = objTags.includes('UnderGodForest');
    }

    const result = insertObj.run({
      map_type: pmap.type,
      map_name: pmap.name,
      map_static: isStatic ? 1 : 0,
      gen_group: obj.genGroupId,
      hash_id: obj.data.HashId,
      unit_config_name: obj.data.UnitConfigName,
      ui_name: objGetUiName(obj),
      data: JSON.stringify(obj.data),
      one_hit_mode: (params && params.IsIchigekiActor) ? 1 : 0,
      last_boss_mode: genGroupSkipped.get(obj.genGroupId) ? 0 : 1,
      hard_mode: (params && params.IsHardModeActor) ? 1 : 0,
      disable_rankup_for_hard_mode: (params && params.DisableRankUpForHardMode) ? 1 : 0,
      scale,
      sharp_weapon_judge_type: params ? params.SharpWeaponJudgeType : 0,
      drop: params ? JSON.stringify(objGetDrops(params)) : null,
      equip: params ? JSON.stringify(objGetEquipment(params)) : null,
      ui_drop: params ? objGetUiDrops(params) : null,
      ui_equip: params ? objGetUiEquipment(params) : null,
      messageid: params ? (params['MessageID'] || null) : null,
      region: pmap.type == 'MainField' ? towerNames[mapTower.getCurrentAreaNum(obj.data.Translate[0], obj.data.Translate[2])] : "",
      field_area: area >= 0 ? area : null,
      spawns_with_lotm: lotm ? 1 : 0,
    });
    hashIdToObjIdMap.set(obj.data.HashId, result.lastInsertRowid);
  }

  process.stdout.write('.\n');
}

function processMaps() {
  const MAP_PATH = path.join(util.APP_ROOT, 'content/map');
  for (const type of fs.readdirSync(MAP_PATH)) {
    const typeP = path.join(MAP_PATH, type);
    for (const name of fs.readdirSync(typeP)) {
      const nameP = path.join(typeP, name);
      if (!util.isDirectory(nameP))
        continue;

      let fileName = `${name}_Static.json`;
      let data: object = JSON.parse(fs.readFileSync(path.join(nameP, fileName), 'utf8'));
      const staticMap = new PlacementMap(type, name, data);

      fileName = `${name}_Dynamic.json`;
      data = JSON.parse(fs.readFileSync(path.join(nameP, fileName), 'utf8'));
      const dynamicMap = new PlacementMap(type, name, data);

      processMap(staticMap, true);
      processMap(dynamicMap, false);
    }
  }
}
db.transaction(() => processMaps())();

function createDropTable() {
  let stmt = db.prepare(`INSERT INTO drop_table (actor_name, name, data) VALUES (@actor_name, @name, @data)`);
  dropData.forEach((row: any) => {
    let result = stmt.run({ actor_name: row.actor_name, name: row.name, data: JSON.stringify(row.data) });
  });
}

console.log('creating drop data table...');
db.transaction(() => createDropTable())();

function createIndexes() {
  db.exec(`
    CREATE INDEX objs_map ON objs (map_type, map_name);
    CREATE INDEX objs_map_type ON objs (map_type);
    CREATE INDEX objs_hash_id ON objs (hash_id);
    CREATE INDEX objs_gen_group ON objs (gen_group);
    CREATE INDEX objs_unit_config_name ON objs (unit_config_name);
  `);
}
console.log('creating indexes...');
createIndexes();

function createFts() {
  db.exec(`
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", map, actor, name, data, 'drop', equip, onehit, lastboss, hard, no_rankup, scale, bonus, static, region, fieldarea, lotm);

    INSERT INTO objs_fts(rowid, map, actor, name, data, 'drop', equip, onehit, lastboss, hard, no_rankup, scale, bonus, static, region, fieldarea, lotm)
    SELECT objid, map_type||'/'||map_name, unit_config_name, ui_name, data, ui_drop, ui_equip, one_hit_mode, last_boss_mode, hard_mode, disable_rankup_for_hard_mode, scale, sharp_weapon_judge_type, map_static, region, field_area, spawns_with_lotm FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
fs.renameSync('map.db.tmp', 'map.db');
