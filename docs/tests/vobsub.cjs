"use strict";
const assert=require("node:assert/strict");
const v=require("../vobsub.js");
const privateData="size: 720x480\npalette: "+
  ["000000","ffffff",...Array(14).fill("888888")].join(", ");
const info=v.parsePrivate(new TextEncoder().encode(privateData));
assert.equal(info.width,720);
assert.equal(info.palette[1][0],255);
assert.equal(v.canRender("S_VOBSUB"),true);
assert.equal(v.canRender("S_HDMV/PGS"),false);
// A tiny 2x2 SPU: two top/bottom 1-nibble RLE runs with the most opaque
// palette entry assigned to color index 1.
const packet=new Uint8Array(34);
packet[0]=0;packet[1]=34;packet[2]=0;packet[3]=8;
packet[4]=0x90;packet[5]=0; // first row: length 2, color 1
packet[6]=0x90;packet[7]=0; // second row
let p=8;
packet.set([0,0,0,8,0x01,0x03,0,0x10,0x04,0,0xf0,
  0x05,0,0,1,0,0,1,0x06,0,4,0,6,0xff],p);
const e=v.unpackPacket(packet,info,2.5,null);
assert.ok(e);
assert.equal(e.width,720);
assert.equal(e.bitmapWidth,2);
assert.equal(e.bitmapHeight,2);
assert.equal(e.start,2.5);
assert.equal(e.pixels.length,16);
assert.equal(e.pixels[3],255);
assert.equal(e.pixels[7],255);
assert.equal(v.frameAt([e],2.6),e);
assert.equal(v.frameAt([e],1),null);
assert.throws(()=>v.parsePrivate("size: 720x480"),/palette/);
assert.throws(()=>v.unpackPacket(new Uint8Array(4),info),/packet/);
console.log("PASS: VobSub IDX palette, DVD SPU RLE, timeline and limits");
