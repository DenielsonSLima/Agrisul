import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url),dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const condition=dataUrl(compile('modules/dashboard-news/weatherCondition.ts'));
const source=compile('modules/dashboard-news/WeatherIcon.tsx').replace(/from ['"]lucide-react['"]/g,`from ${JSON.stringify(pathToFileURL(require.resolve('lucide-react')).href)}`).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)}`).replace(/from ['"]\.\/weatherCondition['"]/g,`from ${JSON.stringify(condition)}`);
const {WeatherIcon}=await import(dataUrl(source));
const render=(condition,daylight=true)=>renderToStaticMarkup(createElement(WeatherIcon,{condition,daylight}));
test('real weather SVG markup uses sun plus cloud for partial sky and moon at night',()=>{
 const partial=render('Parcialmente nublado');assert.match(partial,/weather-icon-sun/);assert.match(partial,/weather-icon-cloud/);
 const night=render('Céu claro',false);assert.match(night,/weather-icon-moon/);assert.doesNotMatch(night,/weather-icon-sun|weather-icon-cloud/);
 const partialNight=render('Poucas nuvens',false);assert.match(partialNight,/weather-icon-moon/);assert.match(partialNight,/weather-icon-cloud/);
});
test('unknown weather does not imply clouds and possible rain has a separate visual qualifier',()=>{
 const unknown=render('Previsão indisponível');assert.match(unknown,/weather-icon-unknown/);assert.doesNotMatch(unknown,/weather-icon-cloud|weather-icon-rain|weather-icon-sun/);
 const possible=render('Muitas nuvens com possibilidade de chuva isolada');assert.match(possible,/is-possible/);assert.match(possible,/weather-icon-possibility/);
 assert.doesNotMatch(render('Muitas nuvens com chuva isolada'),/is-possible|weather-icon-possibility/);
});
