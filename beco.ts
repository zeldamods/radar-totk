
import * as fs from 'fs';

export class BecoSegment {
  data: number; // u16
  length: number;  // u16
  constructor(data: number, length: number) {
    this.data = data;
    this.length = length;
  }
}

function clamp(v: number, v0: number, v1: number): number {
  if (v < v0) {
    v = v0;
  }
  if (v > v1) {
    v = v1;
  }
  return v;
}

export class Beco {
  magic: number; // u32
  num_rows: number; // u32
  divisor: number; // u32
  padding: number; // u32
  // Offsets to row data, divided by 2 and relative to the start of the row section
  offsets: number[]; // u32, size num_rows
  segments: BecoSegment[][]; // Rows x Segments
  constructor(file: string) {
    let little = true;
    let buf = fs.readFileSync(file);
    let arr = new Uint8Array(buf.byteLength);
    buf.copy(arr, 0, 0, buf.byteLength);
    let dv = new DataView(arr.buffer);
    this.magic = dv.getUint32(0, little);
    if (this.magic != 0x00112233) {
      throw `Expected magic number 0x00112233, found ${this.magic}`;
    }
    this.num_rows = dv.getUint32(4, little);
    this.divisor = dv.getUint32(8, little);
    this.padding = dv.getUint32(12, little);

    this.offsets = [];
    // Initial offset of segments
    let off0 = 16 + this.num_rows * 4;
    for (let i = 0; i < this.num_rows; i++) {
      this.offsets.push(off0 + dv.getUint32(16 + i * 4, little) * 2);
    }
    // Add end offset for last row; offsets is 1 larger than other rows
    this.offsets.push(buf.byteLength);

    this.segments = [];
    for (let i = 0; i < this.num_rows; i++) {
      let ioff = this.offsets[i];
      let ioff1 = this.offsets[i + 1];
      let row = [];
      while (ioff < ioff1) {
        let data: number = dv.getUint16(ioff + 0, little);
        let length: number = dv.getUint16(ioff + 2, little);
        row.push(new BecoSegment(data, length));
        ioff += 4;
      }
      this.segments.push(row);
    }
  }

  getCurrentAreaNum(posx: number, posz: number) {
    let x0 = posx;
    let z0 = posz;
    posx = clamp(posx, -5000, 4999);
    posz = clamp(posz, -4000, 4000);
    let epsx = (posx + 5000 < 0.0) ? -0.5 : 0.5;
    let epsz = (posz + 4000 < 0.0) ? -0.5 : 0.5;
    let x = Math.trunc(posx + 5000.0 + epsx);
    let z = Math.trunc((posz + 4000.0 + epsz) / this.divisor);

    let row = clamp(z, 0, this.num_rows - 1);
    if (this.divisor == 10) {
      x = x / 10;
    }
    if (this.offsets[row] >= this.offsets[row + 1]) {
      return 0xFFFFFFFF;
    }
    let seg = this.segments[row];
    let totalLength = 0;
    for (let i = 0; i < seg.length; i++) {
      totalLength += seg[i].length;
      if (x < totalLength) {
        return seg[i].data;
      }
    }
    return 0xFFFFFFFF;
  }
}
