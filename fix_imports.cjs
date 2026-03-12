const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');
code = code.replace(/import \{ EdgeMeta\, SiblingAssignment \} from '\.\/types';.*/g, '');
code = "import { EdgeMeta, SiblingAssignment } from './types';\n" + code;
fs.writeFileSync('src/SplitTool.ts', code);
