// All lexicon files. AI and pilot lexicons are separate grammars (they share syntax, not phrasing).
import aiCore from './ai/core.js';
import aiContacts from './ai/contacts.js';
import aiWeapons from './ai/weapons.js';
import aiSystems from './ai/systems.js';
import aiExplain from './ai/explain.js';
import aiSocial from './ai/social.js';
import pilotCore from './pilot/core.js';
import pilotResponses from './pilot/responses.js';
import pilotReports from './pilot/reports.js';
import pilotOrders from './pilot/orders.js';
import pilotSocial from './pilot/social.js';

export const AI_LEXICONS = [aiCore, aiContacts, aiWeapons, aiSystems, aiExplain, aiSocial];
export const PILOT_LEXICONS = [pilotCore, pilotResponses, pilotReports, pilotOrders, pilotSocial];
