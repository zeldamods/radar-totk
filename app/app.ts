// @ts-ignore
import cors from 'cors';
import express from 'express';
import path from 'path';
import responseTime from 'response-time';
import sqlite3 from 'better-sqlite3';
import * as util from './util';

const db = sqlite3(path.join(util.APP_ROOT, 'map.db'), {
  // @ts-ignore
  // verbose: console.log,
});
const app = express();

app.use(cors());
app.use(responseTime());

function parseResult(result: any): {[key: string]: any} {
  if (!result)
    return {};

  result.data = JSON.parse(result.data);
  return result;
}

const FIELDS = `objid, map_type, map_name, hash_id, unit_config_name, ui_drop, ui_equip, data`;

app.get('/search/:map_type', (req, res) => {
  const mapType = req.params.map_type;
  const q = req.query.q;
  if (!q) {
    res.json([]);
    return;
  }

  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type
      AND objid in (SELECT rowid FROM objs_fts(@q))
    LIMIT 20`);
  res.json(stmt.all({
    map_type: mapType,
    q,
  }).map(parseResult));
});

app.get('/obj/:objid', (req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE objid = @objid LIMIT 1`);
  const result = parseResult(stmt.get({
    objid: parseInt(req.params.objid, 0),
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

app.get('/obj/:map_type/:map_name/:hash_id', (req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type
      AND map_name = @map_name
      AND hash_id = @hash_id LIMIT 1`);
  const result = parseResult(stmt.get({
    map_type: req.params.map_type,
    map_name: req.params.map_name,
    hash_id: parseInt(req.params.hash_id, 0),
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

app.get('/obj/:map_type/:map_name/:hash_id/gen_group', (req, res) => {
  const result = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE gen_group =
       (SELECT gen_group FROM objs
          WHERE map_type = @map_type
            AND map_name = @map_name
            AND hash_id = @hash_id LIMIT 1)`)
  .all({
    map_type: req.params.map_type,
    map_name: req.params.map_name,
    hash_id: parseInt(req.params.hash_id, 0),
  }).map(parseResult);
  if (!result.length)
    return res.status(404).json([]);
  res.json(result);
});

function handleReqObjs(req: express.Request, res: express.Response) {
  const mapType: string|undefined = req.params.map_type;
  const mapName: string|undefined = req.params.map_name;
  const withMapNames: boolean = !!req.query.withMapNames;
  const q: string|undefined = req.query.q;
  if (!q) {
    res.json([]);
    return;
  }

  const getCoords = (x: any) => {
    const data = JSON.parse(x.data);
    const result = {
      objid: x.objid,
      map_name: withMapNames ? x.map_name : undefined,
      name: x.unit_config_name,
      ui_drop: x.ui_drop ? x.ui_drop : undefined,
      ui_equip: x.ui_equip ? x.ui_equip : undefined,
      pos: [Math.round(data.Translate[0]*100)/100, Math.round(data.Translate[2]*100)/100],
    };
    return result;
  };

  const mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  const query = `SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type ${mapNameQuery}
      AND objid in (SELECT rowid FROM objs_fts(@q))`;

  const stmt = db.prepare(query);

  res.json(stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q,
  }).map(getCoords));
}

app.get('/objs/:map_type', handleReqObjs);
app.get('/objs/:map_type/:map_name', handleReqObjs);

app.listen(3007);
