from pathlib import Path

p=Path('worker/timetables.js')
s=p.read_text()
old="""    if(!entries.length){
      const rows=key==='weekday'?'.wektime':key==='saturday'?'.sattime,.doytime':'.holtime,.kyutime';
      $(rows).each((_,e)=>{const row=$(e),hour=Number(clean(row.find('h3').first().text()));if(!Number.isInteger(hour)||hour<0||hour>24)return;
        row.find('td.timetable span[data-no]').each((_,a)=>{const min=clean($(a).text());if(!/^\\d{1,2}$/.test(min)||+min>59)return;entries.push({depart:hour*60+(+min),category:null,destination:null,note:clean($(a).attr('title'))});});
      });
    }"""
new="""    if(!entries.length){
      const current=key==='weekday'?'.tt-time.wek':key==='saturday'?'.tt-time.sat':'.tt-time.hol';
      $(current).each((_,e)=>{const cell=$(e),heading=clean(cell.find('h3').first().text()),hour=Number(heading.match(/(\\d{1,2})時台/)?.[1]);if(!Number.isInteger(hour)||hour<0||hour>24)return;
        const body=cell.clone();body.find('h3').remove();for(const match of clean(body.text()).matchAll(/(?:^|\\s)(\\d{1,2})(?=\\s|$)/g)){const min=Number(match[1]);if(min<0||min>59)continue;entries.push({depart:hour*60+min,category:null,destination:null,note:''});}
      });
    }
    if(!entries.length){
      const rows=key==='weekday'?'.wektime':key==='saturday'?'.sattime,.doytime':'.holtime,.kyutime';
      $(rows).each((_,e)=>{const row=$(e),hour=Number(clean(row.find('h3').first().text()));if(!Number.isInteger(hour)||hour<0||hour>24)return;
        row.find('td.timetable span[data-no]').each((_,a)=>{const min=clean($(a).text());if(!/^\\d{1,2}$/.test(min)||+min>59)return;entries.push({depart:hour*60+(+min),category:null,destination:null,note:clean($(a).attr('title'))});});
      });
    }"""
if old not in s:
    raise SystemExit('legacy Hyperdia block not found')
p.write_text(s.replace(old,new,1))
