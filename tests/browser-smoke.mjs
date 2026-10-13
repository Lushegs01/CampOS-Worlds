import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
const BASE=(process.env.TEST_URL||'http://localhost:5173')+'/';
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await mkdir('docs/screenshots',{recursive:true});
try{
 await page.goto(BASE);await page.getByRole('button',{name:'Enter campus',exact:true}).waitFor({state:'visible'});await page.waitForTimeout(4500);await page.screenshot({path:'docs/screenshots/welcome-desktop.png'});
 await page.getByRole('button',{name:'Make it you'}).click();await page.getByRole('textbox',{name:'What should we call you?'}).fill('Ada');await page.getByRole('button',{name:'Skin tone 3',exact:true}).click();await page.getByRole('button',{name:'bun',exact:true}).click();await page.getByRole('button',{name:'Outfit 2',exact:true}).click();await page.screenshot({path:'docs/screenshots/avatar.png'});await page.getByRole('button',{name:'Close panel'}).click();
 await page.getByRole('button',{name:'Enter campus',exact:true}).click();await page.getByRole('button',{name:/online/}).waitFor();await page.waitForTimeout(4000);console.log('entered',await page.evaluate(()=>window.__campus));await page.screenshot({path:'docs/screenshots/gameplay-desktop.png'});
 await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW');await page.waitForTimeout(1500);
 const metrics=await page.evaluate(()=>window.__campus);await writeFile('docs/smoke-results.json',JSON.stringify({errors,metrics},null,2));console.log(JSON.stringify({errors,metrics}));
 await page.keyboard.press('Escape');await page.screenshot({path:'docs/screenshots/settings.png'});
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});await mobile.goto(BASE);await mobile.getByRole('button',{name:'Enter campus',exact:true}).waitFor();await mobile.waitForTimeout(2000);await mobile.screenshot({path:'docs/screenshots/welcome-mobile.png'});await mobile.getByRole('button',{name:'Enter campus',exact:true}).click();await mobile.waitForTimeout(3000);await mobile.screenshot({path:'docs/screenshots/gameplay-mobile.png'});
}finally{await browser.close();}
