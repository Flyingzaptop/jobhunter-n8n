import test from 'node:test';
import assert from 'node:assert/strict';
import {preloadedCaptchaRecoveryEvidence} from '../services/core/captcha-preload-recovery.mjs';
test('false-positive recovery requires untouched form and observed inactive invisible widget without claiming human solve',()=>{
 const view={captcha:false,action_history:[{operation:'navigate'}],fields:[{visible:true,type:'email',value:''}],uploaded_file_hashes:[],captcha_observation:{pending:false,frames:[{provider:'recaptcha',size:'invisible',path:'/recaptcha/api2/anchor',pending:false,checkbox_visible:false}]}};
 assert.deepEqual(preloadedCaptchaRecoveryEvidence(view),{pass:true,human_captcha_solved:false});
 for(const patch of [{captcha:true},{captcha_observation:{pending:false,frames:[]}},{captcha_observation:{pending:true,frames:view.captcha_observation.frames}},{action_history:[{operation:'fill'}]},{action_history:[{operation:'human_captcha_click'}]},{action_history:[{operation:'submit_intent'}]},{uploaded_file_hashes:[{sha256:'prior-upload'}]},{fields:[{visible:true,type:'email',value:'previous-user-value'}]}])assert.equal(preloadedCaptchaRecoveryEvidence({...view,...patch}).pass,false);
});
