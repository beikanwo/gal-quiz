import test from 'node:test';
import assert from 'node:assert/strict';
import {safeCover,selectReleaseCover} from '../covers.mjs';
import {Metadata} from '../metadata.mjs';
const image={id:'cv1',url:'https://t.vndb.org/cv/01/1.jpg',thumbnail:'https://t.vndb.org/cv.t/01/1.jpg',sexual:0,violence:0,type:'pkgfront',photo:false,dims:[500,700],vn:null};
const release={id:'r1',official:true,vns:[{id:'v1'}],images:[image]};
test('alternate covers require a safe official release and an explicit game relation',()=>{
  assert.equal(selectReleaseCover('v1',[release]).releaseId,'r1');
  assert.equal(selectReleaseCover('v2',[release]),null);
  assert.equal(selectReleaseCover('v1',[{...release,official:false}]),null);
  assert.equal(selectReleaseCover('v1',[{...release,vns:[{id:'v1'},{id:'v2'}]}]),null);
  assert.ok(selectReleaseCover('v1',[{...release,vns:[{id:'v1'},{id:'v2'}],images:[{...image,vn:'v1'}]}]));
  for(const change of [{sexual:.1},{sexual:null},{violence:.1},{url:'javascript:alert(1)'}])assert.equal(safeCover({...image,...change}),null);
  for(const change of [{type:'pkgback'},{photo:true},{vn:'v2'}])assert.equal(selectReleaseCover('v1',[{...release,images:[{...image,...change}]}]),null);
});
test('summary refresh preserves a verified release cover when the default is unsuitable',()=>{
  const cover=selectReleaseCover('v1',[release]);
  const catalog={works:{v1:{id:'v1',title:'游戏',image:cover.url,cover}},staff:{},producers:{}};
  const metadata=new Metadata(catalog);
  metadata.work({id:'v1',title:'游戏',image:{...image,sexual:1}});
  assert.equal(catalog.works.v1.image,cover.url);
  assert.equal(catalog.works.v1.cover.releaseId,'r1');
});
