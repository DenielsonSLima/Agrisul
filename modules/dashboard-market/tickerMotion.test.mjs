import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTickerMotion,MARKET_ITEM_WIDTH,marketDirection,readTickerSpeed,tickerLayout,tickerRepeatCount} from './tickerMotion.mjs';

test('one indicator repeats enough times to cover the whole TV viewport',()=>{
  for(const viewport of [320,1200,1920,3840]){
    const repeats=tickerRepeatCount(viewport,1);
    assert.ok(repeats*MARKET_ITEM_WIDTH>=viewport);
    assert.ok((repeats-1)*MARKET_ITEM_WIDTH<viewport);
  }
  assert.equal(tickerRepeatCount(1920,9),1);
});
test('speed preferences reject malformed values and preserve supported saved speeds',()=>{
  for(const raw of [null,'','bad','Infinity'])assert.equal(readTickerSpeed(raw),60);
  assert.equal(readTickerSpeed('90'),90);assert.equal(readTickerSpeed('999'),140);assert.equal(readTickerSpeed('-1'),20);
});
test('colors follow published direction; missing, malformed or zero changes remain neutral',()=>{
  for(const value of [undefined,null,'','0','-0','0.000','bad'])assert.equal(marketDirection(value),'neutral');
  assert.equal(marketDirection('-0.0001'),'down');assert.equal(marketDirection('0.0001'),'up');
});
function animationFixture(){
  const calls={create:0,cancel:0,keyframes:0,timing:0,pause:0,play:0,rates:[]};
  const animation={currentTime:0,playState:'running',effect:{setKeyframes(){calls.keyframes++;},updateTiming(){calls.timing++;}},updatePlaybackRate(rate){calls.rates.push(rate);},pause(){calls.pause++;this.playState='paused';},play(){calls.play++;this.playState='running';},cancel(){calls.cancel++;}};
  const motion=createTickerMotion({animate(){calls.create++;return animation;}});
  return {motion,animation,calls};
}
test('refetch-equivalent updates, pause/resume and speed changes preserve the same animation and position',()=>{
  const {motion,animation,calls}=animationFixture();
  motion.update(1440,60,false);animation.currentTime=10500;
  motion.update(1440,60,false);motion.update(1440,60,true);
  assert.equal(animation.currentTime,10500);assert.equal(calls.pause,1);
  motion.update(1440,120,true);
  assert.equal(animation.currentTime,10500);assert.deepEqual(calls.rates,[1,2]);
  motion.update(1440,120,false);
  assert.equal(animation.currentTime,10500);assert.equal(calls.play,1);
  assert.equal(calls.create,1);assert.equal(calls.cancel,0);assert.equal(calls.keyframes,0);assert.equal(calls.timing,0);
  motion.destroy();assert.equal(calls.cancel,1);
});
test('resize updates loop distance while preserving the visible pixel offset across previous iterations',()=>{
  const {motion,animation,calls}=animationFixture();
  motion.update(1440,60,false);animation.currentTime=35000;
  const previousOffset=(animation.currentTime*60/1000)%1440;
  motion.update(2880,60,false);
  assert.equal(animation.currentTime*60/1000,previousOffset);
  assert.equal(calls.create,1);assert.equal(calls.cancel,0);assert.equal(calls.keyframes,1);assert.equal(calls.timing,1);
  motion.update(960,60,false);
  assert.equal(animation.currentTime*60/1000,previousOffset%960);
});
test('measured CSS widths, including unequal item sizes and fractional pixels, cover TV viewports',()=>{
  for(const viewport of [320,1920,3840,4096])for(const cycleWidth of [240,260,279.5,725.25]){
    const {repeats,distance}=tickerLayout(viewport,cycleWidth===725.25?3:1,cycleWidth);
    assert.ok(distance>=viewport);
    assert.ok(distance-cycleWidth<viewport);
    // Two equal groups leave at least one viewport of content after every
    // possible offset, including the final pixel before wrapping.
    assert.ok(distance*2-(distance-0.01)>=viewport);
    assert.equal(distance,cycleWidth*repeats);
  }
  assert.equal(tickerRepeatCount(3840,1,240),16);
  assert.equal(tickerRepeatCount(3840,1,280),14);
});
test('unmeasured or hidden geometry has finite defaults and an empty catalog never starts a loop',()=>{
  assert.deepEqual(tickerLayout(3840,1,0),{repeats:15,distance:3900});
  assert.deepEqual(tickerLayout(3840,0,0),{repeats:1,distance:0});
  for(const viewport of [undefined,NaN,Infinity,-1])assert.deepEqual(tickerLayout(viewport,1,260),{repeats:1,distance:260});
  for(const width of [undefined,NaN,Infinity,-1])assert.deepEqual(tickerLayout(3840,1,width),{repeats:15,distance:3900});
  const {motion,calls}=animationFixture();
  for(const distance of [0,NaN,Infinity,-1])motion.update(distance,60,false);
  assert.equal(calls.create,0);
});
test('a compact CSS resize while paused at a changed rate retains the pixel position and pause state',()=>{
  const {motion,animation,calls}=animationFixture();
  motion.update(4320,120,false);animation.currentTime=83000;
  const offset=(animation.currentTime*60/1000)%4320;
  motion.update(4320,120,true);
  motion.update(2340,120,true);
  assert.equal(animation.currentTime*60/1000,offset%2340);
  assert.equal(animation.playState,'paused');assert.equal(calls.pause,1);
  assert.equal(calls.play,0);assert.equal(calls.create,1);assert.equal(calls.cancel,0);
  motion.update(2340,20,false);
  assert.equal(animation.currentTime*60/1000,offset%2340);
  assert.deepEqual(calls.rates,[2,1/3]);assert.equal(calls.play,1);
});
