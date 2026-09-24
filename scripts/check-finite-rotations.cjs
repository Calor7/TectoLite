const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseRotations,multiply,inverse,axis}=require('./lib/finite-rotations.cjs');
const fs=require('node:fs');
const path=require('node:path');
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8));
test('resolves a reference circuit and chronological inverse',()=>{
    const m=parseRotations('1 0 90 0 0 0\n1 200 90 0 40 0\n2 0 0 0 0 1\n2 200 0 0 60 1');
    close(m.at(2,100),multiply(axis(90,0,20),axis(0,0,30)));
    close(multiply(m.at(2,0),inverse(m.at(2,200))),inverse(m.at(2,200)));
});
test('handles a fixed-reference switch without interpolating between reference frames',()=>{
    const m=parseRotations('1 0 90 0 0 0\n1 200 90 0 40 0\n2 0 90 0 0 0\n2 100 90 0 40 0\n2 100 90 0 20 1\n2 200 90 0 40 1');
    close(m.at(2,100),axis(90,0,40));close(m.at(2,150),axis(90,0,60));
});
test('rejects missing and cyclic reconstruction circuits',()=>{
    assert.throws(()=>parseRotations('2 0 90 0 0 1\n2 200 90 0 40 1').at(2,100),/Missing/);
    assert.throws(()=>parseRotations('1 0 90 0 0 2\n1 200 90 0 40 2\n2 0 90 0 0 1\n2 200 90 0 40 1').at(2,100),/Cyclic/);
});
test('finite-rotation direction reproduces five independent bundled 200 Ma export samples',()=>{
    const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p),'utf8'));
    const model=parseRotations(fs.readFileSync(path.join(__dirname,'../gplates_references/1000_0_rotfile.rot'),'utf8'));
    const modern=read('gplates_references/shapes_continents/reconstructed_0.00Ma.geojson').features;
    const past=read('gplates_references/shapes_continents/reconstructed_200.00Ma.geojson').features;
    for(const id of [101,201,501,701,801]){
        const a=modern.find(f=>f.properties.PLATEID1===id),b=past.find(f=>f.properties.FEATURE_ID===a.properties.FEATURE_ID);
        const [lon,lat]=a.geometry.coordinates.flat(3).slice(0,2).map(n=>n*Math.PI/180),q=model.at(id,200);
        const v=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],u=q.slice(1),d=u.reduce((s,n,i)=>s+n*v[i],0);
        const c=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        const rotated=v.map((n,i)=>2*d*u[i]+(2*q[0]*q[0]-1)*n+2*q[0]*c[i]);
        const actual=[Math.atan2(rotated[1],rotated[0])*180/Math.PI,Math.asin(rotated[2])*180/Math.PI];
        actual.forEach((n,i)=>assert.ok(Math.abs(n-b.geometry.coordinates.flat(3)[i])<1e-6,`plate ${id}`));
    }
});
