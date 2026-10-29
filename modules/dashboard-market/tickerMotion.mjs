// First-render fallback only. The hook measures the rendered CSS layout.
export const MARKET_ITEM_WIDTH=260;
export const DEFAULT_TICKER_SPEED=60;
export function readTickerSpeed(raw){
  const value=Number(raw);
  return raw!==null&&raw!==''&&Number.isFinite(value)?Math.min(140,Math.max(20,value)):DEFAULT_TICKER_SPEED;
}
export function tickerLayout(viewport,itemCount,measuredCycleWidth){
  const count=Number.isFinite(itemCount)?Math.max(0,Math.floor(itemCount)):0;
  if(!count)return {repeats:1,distance:0};
  const cycleWidth=Number.isFinite(measuredCycleWidth)&&measuredCycleWidth>0?measuredCycleWidth:count*MARKET_ITEM_WIDTH;
  const width=Number.isFinite(viewport)?Math.max(0,viewport):0;
  const repeats=Math.max(1,Math.ceil(width/cycleWidth));
  return {repeats,distance:cycleWidth*repeats};
}
export function tickerRepeatCount(viewport,itemCount,itemWidth=MARKET_ITEM_WIDTH){
  return tickerLayout(viewport,itemCount,itemCount*itemWidth).repeats;
}
export function marketDirection(percentage){
  if(percentage===undefined||percentage===null||percentage==='')return 'neutral';
  const value=Number(percentage);
  return !Number.isFinite(value)||value===0?'neutral':value>0?'up':'down';
}
const modulo=(value,period)=>((value%period)+period)%period;

// One animation for the mounted track. Changing rate never changes its timeline;
// changing the repeated group width remaps the same pixel offset to the new loop.
export function createTickerMotion(element){
  let animation=null,distance=0,speed=null;
  const baseSpeed=DEFAULT_TICKER_SPEED;
  return {
    update(nextDistance,nextSpeed,paused){
      if(!Number.isFinite(nextDistance)||!(nextDistance>0)||typeof element.animate!=='function')return;
      const duration=nextDistance/baseSpeed*1000;
      if(!animation){
        animation=element.animate([{transform:'translateX(0px)'},{transform:`translateX(-${nextDistance}px)`}],{duration,iterations:Infinity,easing:'linear',fill:'both'});
        distance=nextDistance;
      }else if(distance!==nextDistance){
        const time=Number(animation.currentTime)||0;
        const offset=modulo(time/1000*baseSpeed,distance);
        animation.effect.setKeyframes([{transform:'translateX(0px)'},{transform:`translateX(-${nextDistance}px)`}]);
        animation.effect.updateTiming({duration});
        animation.currentTime=modulo(offset,nextDistance)/baseSpeed*1000;
        distance=nextDistance;
      }
      if(speed!==nextSpeed){animation.updatePlaybackRate(nextSpeed/baseSpeed);speed=nextSpeed;}
      if(paused&&animation.playState!=='paused')animation.pause();
      else if(!paused&&animation.playState!=='running')animation.play();
    },
    destroy(){animation?.cancel();animation=null;},
  };
}
