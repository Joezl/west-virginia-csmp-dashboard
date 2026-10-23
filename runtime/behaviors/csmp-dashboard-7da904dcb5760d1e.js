export default async function install(app) {
  const chartsMount = app.getMount('dashboard-charts');
  const countyMount = app.getMount('county-dashboard');
  const trendMount = app.getMount('trend-dashboard');
  const pdmp = app.layers[app.config.pdmpLayerId];
  const trendLayer = app.layers[app.config.trendLayerId];
  const selectedCounties = new Set();
  const hiddenDrugs = new Set();
  let request = 0;
  let refreshTimer = null;

  const css = (el, styles) => Object.assign(el.style, styles);
  const sum = (rows, fields) => fields.map(field => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0));
  const whereClause = () => {
    if (!selectedCounties.size) return '1=1';
    return `county IN (${[...selectedCounties].map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')})`;
  };
  const heading = (text) => {
    const h = document.createElement('div'); h.textContent = text;
    css(h, {fontWeight:'600', fontSize:'13px', color:'var(--calcite-color-text-1)', margin:'6px 0 4px'});
    return h;
  };
  const card = () => {
    const el = document.createElement('section');
    css(el, {border:'1px solid var(--calcite-color-border-3)', borderRadius:'7px', padding:'7px', marginBottom:'8px', background:'var(--calcite-color-foreground-1)'});
    return el;
  };
  const makeBars = (title, labels, values, color='#2867d4') => {
    const section = card(); section.appendChild(heading(title));
    const max = Math.max(...values, 1);
    labels.forEach((label, i) => {
      const row = document.createElement('div'); css(row,{display:'grid',gridTemplateColumns:'minmax(85px, 40%) 1fr',gap:'6px',alignItems:'center',margin:'4px 0'});
      const name = document.createElement('div'); name.textContent=label; css(name,{fontSize:'11px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'});
      const track=document.createElement('div'); css(track,{height:'18px',background:'var(--calcite-color-foreground-2)',borderRadius:'3px',position:'relative',minWidth:'0'});
      const bar=document.createElement('div'); css(bar,{height:'100%',width:`${Math.max(1,values[i]/max*100)}%`,background:color,borderRadius:'3px'});
      const value=document.createElement('span'); value.textContent=Math.round(values[i]).toLocaleString(); css(value,{position:'absolute',right:'4px',top:'1px',fontSize:'10px',fontWeight:'600',color:'var(--calcite-color-text-1)'});
      track.append(bar,value); row.append(name,track); section.appendChild(row);
    });
    return section;
  };
  const renderCharts = (rows) => {
    chartsMount.replaceChildren();
    const paymentFields=['P_Insurance','P_Medicaid','P_Medicare','P_Other_Cash_Insurance','P_Private_Pay','P_Workers','P_Military','P_Indian_Nations'];
    chartsMount.appendChild(makeBars('Prescriptions by payment type',['Insurance','Medicaid','Medicare','Other cash & insurance','Private pay','Workers comp','Military','Indian Nations'],sum(rows,paymentFields),'#2867d4'));
    chartsMount.appendChild(makeBars('Doses by drug class',['Opioids','Benzodiazepines','Stimulants'],sum(rows,['C_Opioids','C_Benzodiazepines','C_Stimulants']),'#1b7f5a'));
    chartsMount.appendChild(makeBars('Doses by schedule',['CII','CIII','CIV','CV'],sum(rows,['Sch_CII','Sch_CIII','Sch_CIV','Sch_CV']),'#9b4dca'));
    chartsMount.appendChild(makeBars('Prescriptions by MME range',['0–19','20–49','50–89','90+'],sum(rows,['MME_0_19','MME_20_49','MME_50_89','MME_ge90']),'#db7a21'));
    chartsMount.appendChild(makeBars('Prescriptions by day supply range',['0–3','4–7','8–14','15–21','22–30','30+'],sum(rows,['D_0_3','D_4_7','D_8_14','D_15_21','D_22_30','DS_g30']),'#be3d6e'));
  };
  const renderCountyPanel = (rows) => {
    countyMount.replaceChildren();
    const stats = card();
    const totalNaloxone=sum(rows,['Naloxone'])[0];
    const gender=sum(rows,['Female','Male','Unknown_Gender']);
    const totalGender=Math.max(gender.reduce((a,b)=>a+b,0),1);
    stats.appendChild(heading('Total naloxone doses'));
    const value=document.createElement('div'); value.textContent=Math.round(totalNaloxone).toLocaleString(); css(value,{fontSize:'27px',fontWeight:'700',color:'#2867d4',lineHeight:'1.1'}); stats.appendChild(value);
    stats.appendChild(heading('Gender split'));
    const pieRow=document.createElement('div'); css(pieRow,{display:'flex',alignItems:'center',gap:'10px'});
    const pie=document.createElement('div'); const female=gender[0]/totalGender*100, male=gender[1]/totalGender*100;
    css(pie,{width:'78px',height:'78px',borderRadius:'50%',flex:'0 0 auto',background:`conic-gradient(#c64e76 0 ${female}%, #2867d4 ${female}% ${female+male}%, #a8a8a8 ${female+male}% 100%)`});
    const legend=document.createElement('div'); css(legend,{fontSize:'11px',lineHeight:'1.6'});
    [['Female',gender[0],'#c64e76'],['Male',gender[1],'#2867d4'],['Unknown',gender[2],'#a8a8a8']].forEach(([name,count,color])=>{const line=document.createElement('div'); const dot=document.createElement('span'); css(dot,{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',background:color,marginRight:'5px'}); line.append(dot,document.createTextNode(`${name}: ${(count/totalGender*100).toFixed(1)}%`)); legend.appendChild(line);});
    pieRow.append(pie,legend); stats.appendChild(pieRow); countyMount.appendChild(stats);
    const listCard=card(); listCard.appendChild(heading('County list — select to filter'));
    const clear=document.createElement('button'); clear.type='button'; clear.textContent='Clear county selection'; clear.disabled=!selectedCounties.size;
    css(clear,{fontSize:'11px',marginBottom:'5px',cursor:'pointer'}); clear.addEventListener('click',()=>{selectedCounties.clear(); refresh();}); listCard.appendChild(clear);
    const counties=[...new Set(rows.map(r=>r.county).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
    const list=document.createElement('div'); css(list,{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:'3px',maxHeight:'225px',overflowY:'auto'});
    counties.forEach(county=>{const button=document.createElement('button'); button.type='button'; button.textContent=county; const selected=selectedCounties.has(county); css(button,{padding:'4px 5px',fontSize:'11px',textAlign:'left',border:'1px solid '+(selected?'#2867d4':'var(--calcite-color-border-3)'),borderRadius:'4px',background:selected?'#dce8ff':'transparent',cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}); button.addEventListener('click',()=>{selected?selectedCounties.delete(county):selectedCounties.add(county); refresh();}); list.appendChild(button);});
    listCard.appendChild(list); countyMount.appendChild(listCard);
  };
  const renderTrend = (rows) => {
    trendMount.replaceChildren(); const section=card(); section.appendChild(heading('Doses by drug type'));
    const series={}; rows.forEach(r=>{const name=r.drugtype || 'Unspecified'; (series[name] ||= []).push({x:Number(r.fillyear),y:Number(r.TotalDoses)||0});});
    Object.values(series).forEach(points=>points.sort((a,b)=>a.x-b.x)); const names=Object.keys(series).sort();
    const active=names.filter(name=>!hiddenDrugs.has(name));
    const allPoints=active.flatMap(name=>series[name]); const years=[...new Set(allPoints.map(p=>p.x))].sort((a,b)=>a-b);
    const max=Math.max(...allPoints.map(p=>p.y),1), minYear=years[0]||0, maxYear=years[years.length-1]||1;
    const palette=['#2867d4','#1b7f5a','#c64e76','#db7a21','#9b4dca','#008a9a'];
    const legend=document.createElement('div'); css(legend,{display:'flex',flexWrap:'wrap',gap:'4px',marginBottom:'5px'});
    names.forEach((name,i)=>{const btn=document.createElement('button'); btn.type='button'; btn.textContent=name; const on=!hiddenDrugs.has(name); css(btn,{fontSize:'10px',padding:'3px 5px',border:`1px solid ${palette[i%palette.length]}`,borderRadius:'9px',background:on?palette[i%palette.length]:'transparent',color:on?'white':'var(--calcite-color-text-1)',cursor:'pointer'}); btn.addEventListener('click',()=>{hiddenDrugs.has(name)?hiddenDrugs.delete(name):hiddenDrugs.add(name); renderTrend(rows);}); legend.appendChild(btn);}); section.appendChild(legend);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 360 190'); svg.setAttribute('width','100%'); svg.setAttribute('height','190');
    const axis=(x1,y1,x2,y2)=>{const l=document.createElementNS(svg.namespaceURI,'line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);l.setAttribute('x2',x2);l.setAttribute('y2',y2);l.setAttribute('stroke','#929292');l.setAttribute('stroke-width','1');svg.appendChild(l);}; axis(36,158,350,158);axis(36,12,36,158);
    years.forEach(year=>{const x=36+(maxYear===minYear?0:(year-minYear)/(maxYear-minYear)*314); const t=document.createElementNS(svg.namespaceURI,'text');t.setAttribute('x',x);t.setAttribute('y','176');t.setAttribute('text-anchor','middle');t.setAttribute('font-size','9');t.textContent=String(year);svg.appendChild(t);});
    active.forEach((name,i)=>{const points=series[name]; const poly=document.createElementNS(svg.namespaceURI,'polyline');poly.setAttribute('fill','none');poly.setAttribute('stroke',palette[names.indexOf(name)%palette.length]);poly.setAttribute('stroke-width','2.5');poly.setAttribute('points',points.map(p=>`${36+(maxYear===minYear?0:(p.x-minYear)/(maxYear-minYear)*314)},${158-p.y/max*140}`).join(' '));svg.appendChild(poly); points.forEach(p=>{const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',36+(maxYear===minYear?0:(p.x-minYear)/(maxYear-minYear)*314));c.setAttribute('cy',158-p.y/max*140);c.setAttribute('r','3');c.setAttribute('fill',palette[names.indexOf(name)%palette.length]); const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=`${name}, ${p.x}: ${Math.round(p.y).toLocaleString()} doses`;c.appendChild(title);svg.appendChild(c);});});
    const ymax=document.createElementNS(svg.namespaceURI,'text'); ymax.setAttribute('x','32');ymax.setAttribute('y','18');ymax.setAttribute('text-anchor','end');ymax.setAttribute('font-size','9');ymax.textContent=Math.round(max).toLocaleString();svg.appendChild(ymax); section.appendChild(svg); trendMount.appendChild(section);
  };
  async function refresh() {
    const current=++request;
    chartsMount.replaceChildren(heading('Updating summaries…')); countyMount.replaceChildren(heading('Updating county measures…')); trendMount.replaceChildren(heading('Updating trend…'));
    try {
      const base={where:whereClause(),outFields:['county','Naloxone','Female','Male','Unknown_Gender','P_Insurance','P_Medicaid','P_Medicare','P_Other_Cash_Insurance','P_Private_Pay','P_Workers','P_Military','P_Indian_Nations','C_Opioids','C_Benzodiazepines','C_Stimulants','Sch_CII','Sch_CIII','Sch_CIV','Sch_CV','MME_0_19','MME_20_49','MME_50_89','MME_ge90','D_0_3','D_4_7','D_8_14','D_15_21','D_22_30','DS_g30'],returnGeometry:false,geometry:app.view.extent,spatialRelationship:'intersects',num:2000};
      const [data,trend]=await Promise.all([pdmp.queryFeatures(base),trendLayer.queryFeatures({where:whereClause(),outFields:['fillyear','county','drugtype','TotalDoses'],returnGeometry:false,geometry:app.view.extent,spatialRelationship:'intersects',num:5000})]);
      if(current!==request) return;
      const rows=data.features.map(f=>f.attributes); renderCharts(rows); renderCountyPanel(rows); renderTrend(trend.features.map(f=>f.attributes));
    } catch (error) {
      if(current!==request) return; const message=document.createElement('div'); message.textContent='Unable to load dashboard summaries.'; chartsMount.replaceChildren(message); countyMount.replaceChildren(); trendMount.replaceChildren(); app.reportError(error);
    }
  }
  const extentHandle=app.view.watch('extent',()=>{clearTimeout(refreshTimer); refreshTimer=setTimeout(refresh,300);});
  app.onCleanup(()=>{extentHandle.remove(); clearTimeout(refreshTimer); chartsMount.replaceChildren(); countyMount.replaceChildren(); trendMount.replaceChildren();});
  await refresh();
}