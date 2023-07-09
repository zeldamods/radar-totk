import sqlite3 from 'better-sqlite3';
// @ts-ignore
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import responseTime from 'response-time';

import { findPolygons } from '../pointInPoly';
import * as util from './util';

const SKY_POLYS = JSON.parse(fs.readFileSync('./tools/sky_polys.json', 'utf8'))

const db = sqlite3(path.join(util.APP_ROOT, 'map.db'), {
  // @ts-ignore
  // verbose: console.log,
});
const app = express();

app.use(cors());
app.use(responseTime());

app.use(express.static(path.join(util.APP_ROOT, 'static')));

function getQueryParamStr(req: express.Request, name: string) {
  const param = req.query[name];
  if (param == null)
    return null;
  if (Array.isArray(param))
    return null;
  return param.toString();
}

function parseResult(result: any): { [key: string]: any } {
  if (!result)
    return {};

  result.data = JSON.parse(result.data);
  result.drop = JSON.parse(result.drops); // change from drops to drop
  result.drops = undefined;

  result.equip = JSON.parse(result.equip);
  result.Location = result.data?.Dynamic?.Location;
  if (result.data.Translate)
    result.pos = result.data.Translate.map((v: number) => Math.round(v * 100) / 100);
  else
    result.pos = [0, 0, 0];
  return result;
}

function generateMapTypeQueryCondition(mapType: string, sqlParamName = "@map_type"): string {
  if (mapType === 'MainAndMinusField') {
    return `(map_type = 'MainField' OR map_type = 'MinusField')`;
  }

  return `map_type = ${sqlParamName}`;
}

const FIELDS = 'objid, map_type, map_name, hash_id, unit_config_name as name, data, scale, drops, equip, map_static, korok_id, korok_type';

// Returns object details for an object.
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

// Returns object details for an object.
app.get('/obj/:map_type/:map_name/:hash_id', (req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE ${generateMapTypeQueryCondition(req.params.map_type)}
      AND map_name = @map_name
      AND hash_id = @hash_id LIMIT 1`);
  const result = parseResult(stmt.get({
    map_type: req.params.map_type,
    map_name: req.params.map_name,
    hash_id: req.params.hash_id,
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

// Returns object details for an object.
app.get('/obj_by_hash/:hash_id', (req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE hash_id = @hash_id LIMIT 1`);
  const result = parseResult(stmt.get({
    hash_id: req.params.hash_id,
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

// Returns the placement generation group for an object.
app.get('/obj/:map_type/:map_name/:hash_id/gen_group', (req, res) => {
  const result = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE gen_group =
       (SELECT gen_group FROM objs
          WHERE ${generateMapTypeQueryCondition(req.params.map_type)}
            AND map_name = @map_name
            AND hash_id = @hash_id LIMIT 1)`)
    .all({
      map_type: req.params.map_type,
      map_name: req.params.map_name,
      hash_id: req.params.hash_id,
    }).map(parseResult);
  res.json(result);
});

// Returns the AI groups for an object.
app.get('/obj/:map_type/:map_name/:hash_id/ai_groups', (req, res) => {
  const result = db.prepare(`SELECT ai_groups.id as id, hash_id, data
    FROM ai_groups
    INNER JOIN ai_group_references
      ON ai_groups.id = ai_group_references.ai_group_id
    WHERE ai_group_references.object_id =
       (SELECT objid FROM objs
          WHERE ${generateMapTypeQueryCondition(req.params.map_type)}
            AND map_name = @map_name
            AND hash_id = @hash_id LIMIT 1)`)
    .all({
      map_type: req.params.map_type,
      map_name: req.params.map_name,
      hash_id: req.params.hash_id,
    });

  for (const group of result) {
    group.data = JSON.parse(group.data);
    group.referenced_entities = {};

    const referencedEntities = db.prepare(`SELECT ${FIELDS}
      FROM objs
      INNER JOIN ai_group_references
        ON objs.objid = ai_group_references.object_id
      WHERE ai_group_references.ai_group_id = @ai_group_id
    `)
      .all({
        ai_group_id: group.id,
      })
      .map(parseResult);

    for (const entity of referencedEntities) {
      group.referenced_entities[entity.hash_id] = entity;
    }
  }

  res.json(result);
});

// Returns minimal object data for all matching objects.
function handleReqObjs(req: express.Request, res: express.Response) {
  const mapType: string | undefined = req.params.map_type;
  const mapName: string | undefined = req.params.map_name;
  const withMapNames: boolean = !!req.query.withMapNames;
  const q: string | null = getQueryParamStr(req, "q");
  const limitStr = getQueryParamStr(req, "limit");
  const limit: number = limitStr != null ? parseInt(limitStr, 10) : -1;
  if (!q) {
    res.json([]);
    return;
  }

  const selectAll = q === "*";

  const getData = (x: any) => {
    x.data = undefined;
    if (!withMapNames)
      x.map_name = undefined;
    return x;
  };

  let mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  if (mapType == 'MainField' && mapName) {
    if (mapName == 'Sky')
      mapNameQuery = ` AND map_name glob 'Sky__%' `;
    else if (mapName == 'Cave')
      mapNameQuery = ` AND map_name glob 'Cave__%' `;
    else if (mapName == 'DeepHole')
      mapNameQuery = ` AND map_name glob 'DeepHole__%' `;
    else if (mapName == 'Surface')
      mapNameQuery = ` AND map_name glob '_-_' `; // Surface map_name, e.g. A-1, C-4, ...
  }
  const mapTypeQuery = generateMapTypeQueryCondition(req.params.map_type);
  const limitQuery = limit != -1 ? 'LIMIT @limit' : '';
  const query = `SELECT ${FIELDS} FROM objs
    WHERE ${mapTypeQuery} ${mapNameQuery}
    ${selectAll ? "" : "AND objid in (SELECT rowid FROM objs_fts(@q))"}
    ${limitQuery}`;

  const stmt = db.prepare(query);

  const rows = stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q: selectAll ? undefined : q,
    limit,
  });
  res.json(rows.map(parseResult).map(getData))
}

app.get('/objs/:map_type', handleReqObjs);
app.get('/objs/:map_type/:map_name', handleReqObjs);

// Returns object IDs for all matching objects.
function handleReqObjids(req: express.Request, res: express.Response) {
  const mapType: string | undefined = req.params.map_type;
  const mapName: string | undefined = req.params.map_name;
  const q: string | null = getQueryParamStr(req, "q");
  if (!q) {
    res.json([]);
    return;
  }

  const mapTypeQuery = generateMapTypeQueryCondition(req.params.map_type);
  const mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  const query = `SELECT objid FROM objs
    WHERE map_type = ${mapTypeQuery} ${mapNameQuery}
      AND objid in (SELECT rowid FROM objs_fts(@q))`;

  const stmt = db.prepare(query);

  res.json(stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q,
  }).map(x => x.objid));
}

app.get('/objids/:map_type', handleReqObjids);
app.get('/objids/:map_type/:map_name', handleReqObjids);


function handleReqRailsTable(req: express.Request, res: express.Response) {
  const stmt = db.prepare(`select data from rails
      join (
          select json_extract(value,'$.Dst') as rail_id from objs, json_each(objs.data, '$.Rails') where hash_id = ?
      ) as t on t.rail_id = rails.hash_id`)
  let rows = stmt.all(req.params.hash_id);
  res.json(rows.map((row: any) => JSON.parse(row.data)));
}
app.get('/rail/:hash_id', handleReqRailsTable);

function handleReqDropTable(req: express.Request, res: express.Response) {
  const actorName: string | undefined = req.params.actor_name; // Matches unit_config_name in table objs
  const tableName: string | undefined = req.params.table_name;
  let rows = [];
  if (!tableName) {
    // Return available drop table names if none provided
    const stmt = db.prepare(`SELECT table_name from drop_tables where unit_config_name = ?`);
    rows = stmt.all(actorName);
  } else {
    const stmt = db.prepare(`SELECT data from drop_tables where unit_config_name = ? and table_name like ? `);
    rows = stmt.get(actorName, tableName);
    if (rows && rows.data) {
      rows = JSON.parse(rows.data);
    }
  }
  res.json(rows);
}
app.get('/drop/:actor_name/:table_name', handleReqDropTable);
app.get('/drop/:actor_name', handleReqDropTable);


app.get('/region/:region/:x/:z', (req: express.Request, res: express.Response) => {
  const maxDistance = 200;
  const pt = [parseFloat(req.params.x), 0, parseFloat(req.params.z)];
  if (req.params.region == "Sky") {
    const names = findPolygons(pt, SKY_POLYS, maxDistance)
      .map(i => SKY_POLYS.features[i].properties.group);
    res.json(names)
  }
});

app.listen(3008);
