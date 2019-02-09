import fs from 'fs';
import path from 'path';

export const APP_ROOT = path.join(__dirname, '../');
export const isDirectory = (p: string) => fs.lstatSync(p).isDirectory();
