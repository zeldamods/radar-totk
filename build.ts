import fs from 'fs';
import path from 'path';
import sqlite3 from 'better-sqlite3';

import {PlacementMap, PlacementObj, PlacementLink, ResPlacementObj} from './app/PlacementMap';
import * as util from './app/util';

const names: {[actor: string]: string} = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'names.json'), 'utf8'));
const getUiName = (name: string) => names[name] || name;
const locationMarkerTexts: {[actor: string]: string} = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'text', 'StaticMsg', 'LocationMarker.json'), 'utf8'));
const dungeonTexts: {[actor: string]: string} = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'text', 'StaticMsg', 'Dungeon.json'), 'utf8'));

try {
  fs.unlinkSync('map.db');
} catch (e) {}
const db = sqlite3('map.db');
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
   hard_mode BOOL DEFAULT 0,
   disable_rankup_for_hard_mode BOOL DEFAULT 0,
   scale INTEGER DEFAULT 0,
   sharp_weapon_judge_type INTEGER DEFAULT 0,
   'drop' JSON,
   equip JSON,
   ui_drop TEXT,
   ui_equip TEXT
  );
`);

const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, map_static, gen_group, hash_id, unit_config_name, ui_name, data, hard_mode, disable_rankup_for_hard_mode, scale, sharp_weapon_judge_type, 'drop', equip, ui_drop, ui_equip)
  VALUES
  (@map_type, @map_name, @map_static, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @hard_mode, @disable_rankup_for_hard_mode, @scale, @sharp_weapon_judge_type, @drop, @equip, @ui_drop, @ui_equip)`);

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
  return {
    drop: params.DropActor || undefined,
    table: (!params.DropActor && params.DropTable && params.DropTable != 'Normal') ? params.DropTable : undefined,
  };
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

  for (const obj of pmap.getObjs()) {
    const params = obj.data['!Parameters'];

    let scale = params ? params.LevelSensorMode : 0;
    if (!obj.data.UnitConfigName.startsWith('Weapon_') && !obj.data.UnitConfigName.startsWith('Enemy_'))
      scale = null;

    const result = insertObj.run({
      map_type: pmap.type,
      map_name: pmap.name,
      map_static: isStatic ? 1 : 0,
      gen_group: obj.genGroupId,
      hash_id: obj.data.HashId,
      unit_config_name: obj.data.UnitConfigName,
      ui_name: objGetUiName(obj),
      data: JSON.stringify(obj.data),
      hard_mode: (params && params.IsHardModeActor) ? 1 : 0,
      disable_rankup_for_hard_mode: (params && params.DisableRankUpForHardMode) ? 1 : 0,
      scale,
      sharp_weapon_judge_type: params ? params.SharpWeaponJudgeType : 0,
      drop: params ? JSON.stringify(objGetDrops(params)) : null,
      equip: params ? JSON.stringify(objGetEquipment(params)) : null,
      ui_drop: params ? objGetUiDrops(params) : null,
      ui_equip: params ? objGetUiEquipment(params) : null,
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
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", actor, name, data, 'drop', equip, hard, no_rankup, scale, bonus);

    INSERT INTO objs_fts(rowid, actor, name, data, 'drop', equip, hard, no_rankup, scale, bonus)
    SELECT objid, unit_config_name, ui_name, data, ui_drop, ui_equip, hard_mode, disable_rankup_for_hard_mode, scale, sharp_weapon_judge_type FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
