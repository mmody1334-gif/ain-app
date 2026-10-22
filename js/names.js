import { SHAPES } from './handModel.js';
import { BUILTIN_MOTIONS } from './motion.js';
export const BUILTIN_NAMES = Object.fromEntries([...SHAPES, ...BUILTIN_MOTIONS].map((x) => [x.id, x.name]));
