"use strict";
const assert = require("node:assert/strict");
const {plan} = require("../queue-autoplay.js");

function check(label, args, expected) {
  const result = plan(...args);
  assert.deepEqual(result, expected, label);
  console.log("PASS:", label);
}
check("Opening a movie with empty player starts it", ["open",-1,0,false],
  {insertAt:0,activate:true,autoplay:true});
check("Opening several movies starts first, queues the others",["open",-1,0,false],
  {insertAt:0,activate:true,autoplay:true});
check("Opening while one movie is playing queues without interrupting",["open",0,3,true],
  {insertAt:3,activate:false,autoplay:false});
check("Opening while paused starts the selected movie",["open",0,3,false],
  {insertAt:1,activate:true,autoplay:true});
check("Opening while stopped starts selected movie",["open",0,2,false],
  {insertAt:1,activate:true,autoplay:true});
check("Opening while only an Up Next list exists starts first",["open",-1,3,false],
  {insertAt:0,activate:true,autoplay:true});
check("Add to Up Next on empty player stays queued",["queue",-1,0,false],
  {insertAt:0,activate:false,autoplay:false});
check("Add to Up Next while playing never interrupts",["queue",0,2,true],
  {insertAt:2,activate:false,autoplay:false});
check("Add to Up Next while paused never interrupts",["queue",0,2,false],
  {insertAt:2,activate:false,autoplay:false});
check("Restore previous file paused",["restore",-1,0,false],
  {insertAt:0,activate:true,autoplay:false});
check("Restore does not interrupt existing selection",["restore",0,2,true],
  {insertAt:2,activate:false,autoplay:false});
assert.throws(() => plan("unexpected",-1,0,false),TypeError);
console.log("PASS: all queue/autoplay planning cases");
