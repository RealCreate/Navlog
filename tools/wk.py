import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.webkit.launch()
        ctx = await b.new_context(**p.devices['iPhone 14 Pro Max'])
        pg = await ctx.new_page(); logs = []
        pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: logs.append(m.type + ' ' + m.text))
        await pg.goto('https://realcreate.github.io/Navlog/'); await pg.wait_for_timeout(6000)
        await pg.evaluate("navlogApp.map.setView([42.42,-3.95],10)"); await pg.wait_for_timeout(5000)
        await pg.screenshot(path='out/wk.png')
        info = await pg.evaluate("""() => { const c=document.querySelector('.places-canvas');
          let px=null; try { const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; px=0; for(let i=3;i<d.length;i+=4) if(d[i]) px++; } catch(e) { px='err '+e; }
          return {ua:navigator.userAgent, canvas: !!c, w: c&&c.width, h: c&&c.height, vis: c&&c.style.visibility, painted: px, ls: 'letterSpacing' in CanvasRenderingContext2D.prototype}; }""")
        print(info)
        try:
            r = await pg.evaluate("""async () => { const m = await import('./js/places.js'); const c=document.createElement('canvas'); c.width=300;c.height=100; const g=c.getContext('2d');
               try { m.drawPlaces(g, [['Burgos',0,0,0],['Lerma',0,0,1]], ()=>[100,50], 10, {}); return 'ok'; } catch(e) { return 'THROW ' + e + ' ' + e.stack; } }""")
            print('direct', r)
        except Exception as e: print('eval err', e)
        print('\n'.join(logs[:30]))
        await b.close()
asyncio.run(main())
