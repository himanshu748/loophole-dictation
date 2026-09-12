import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('public Dictation samples contain audible mono 16 kHz PCM within the request limits',()=>{
  for(const name of ['world-sample.pcm','world-revision-sample.pcm']){
    const data=readFileSync(new URL('../public/'+name,import.meta.url));
    assert.ok(data.length>=8000&&data.length<=1920000,`${name} duration must fit the Dictation request`);
    assert.equal(data.length%2,0,`${name} must contain complete 16-bit samples`);
    let energy=0;for(let offset=0;offset<data.length;offset+=2){const value=data.readInt16LE(offset);energy+=value*value;}
    assert.ok(Math.sqrt(energy/(data.length/2))>100,`${name} must not be silent`);
  }
});
