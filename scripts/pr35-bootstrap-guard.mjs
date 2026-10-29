import {createHash} from 'node:crypto';
export const BOOTSTRAP_SHA256_LF='1bdf0dcc754224cac9829e763bb04e42146dd3253656db6ba1450af0145fa5ae';
export function assertBootstrapIntegrity(source){
 const hash=createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
 if(hash!==BOOTSTRAP_SHA256_LF)throw Error('PR35 STOP: native PG17 bootstrap SHA256 changed');
 return true;
}
