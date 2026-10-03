import {Repository} from '../services/core/repository.mjs';
const repo=new Repository(); try{await repo.migrate();console.log('Migrations applied');}finally{await repo.close();}
