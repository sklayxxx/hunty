// То, что умеет только приложение (Tauri): статус «играет в…» (хоткеи в играх — в keys.js).
// Список программ никуда не уходит: здесь ищем среди них игры, друзьям летит только название игры.
import { prefs, bus } from './core.js';
import { api, inTauri, shell } from './api.js';
import { S } from './state.js';

/* ---------- «играет в…» ---------- */
// имя .exe (в нижнем регистре) → как показать; javaw — почти всегда майн у нашей аудитории, но только если больше ничего не нашли
const GAMES = {
  'minecraft.windows.exe': 'Minecraft', 'minecraftlauncher.exe': 'Minecraft', 'lunar client.exe': 'Minecraft', 'cs2.exe': 'Counter-Strike 2', 'csgo.exe': 'CS:GO',
  'dota2.exe': 'Dota 2', 'valorant-win64-shipping.exe': 'Valorant', 'fortniteclient-win64-shipping.exe': 'Fortnite', 'gta5.exe': 'GTA V', 'gta5_enhanced.exe': 'GTA V',
  'rustclient.exe': 'Rust', 'r5apex.exe': 'Apex Legends', 'r5apex_dx12.exe': 'Apex Legends', 'robloxplayerbeta.exe': 'Roblox', 'league of legends.exe': 'League of Legends',
  'overwatch.exe': 'Overwatch 2', 'tslgame.exe': 'PUBG', 'eldenring.exe': 'Elden Ring', 'cyberpunk2077.exe': 'Cyberpunk 2077', 'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley', 'deadbydaylight-win64-shipping.exe': 'Dead by Daylight', 'rocketleague.exe': 'Rocket League', 'witcher3.exe': 'Ведьмак 3',
  'rainbowsix.exe': 'Rainbow Six Siege', 'rainbowsix_vulkan.exe': 'Rainbow Six Siege', 'destiny2.exe': 'Destiny 2', 'helldivers2.exe': 'Helldivers 2',
  'lethal company.exe': 'Lethal Company', 'phasmophobia.exe': 'Phasmophobia', 'among us.exe': 'Among Us', 'valheim.exe': 'Valheim', 'palworld-win64-shipping.exe': 'Palworld',
  'escapefromtarkov.exe': 'Escape from Tarkov', 'aces.exe': 'War Thunder', 'worldoftanks.exe': 'World of Tanks', 'wow.exe': 'World of Warcraft', 'hearthstone.exe': 'Hearthstone',
  'osu!.exe': 'osu!', 'geometrydash.exe': 'Geometry Dash', 'factorio.exe': 'Factorio', 'bg3.exe': "Baldur's Gate 3", 'bg3_dx11.exe': "Baldur's Gate 3", 'discovery.exe': 'THE FINALS',
  'marvel-win64-shipping.exe': 'Marvel Rivals', 'fc25.exe': 'EA FC 25', 'fc24.exe': 'EA FC 24', 'brawlhalla.exe': 'Brawlhalla', 'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail', 'rdr2.exe': 'Red Dead Redemption 2', 'sotgame.exe': 'Sea of Thieves', 'forzahorizon5.exe': 'Forza Horizon 5', 'dayz_x64.exe': 'DayZ',
  'arma3_x64.exe': 'Arma 3', 'gmod.exe': "Garry's Mod", 'projectzomboid64.exe': 'Project Zomboid', 'fsd-win64-shipping.exe': 'Deep Rock Galactic', 'content warning.exe': 'Content Warning',
  'repo.exe': 'R.E.P.O.', 'peak.exe': 'PEAK', 'deltarune.exe': 'Deltarune', 'hollow_knight.exe': 'Hollow Knight', 'hollow knight silksong.exe': 'Hollow Knight: Silksong',
  'satisfactory.exe': 'Satisfactory', 'subnautica.exe': 'Subnautica', 'raft.exe': 'Raft', 'thelongdark.exe': 'The Long Dark', 'cuphead.exe': 'Cuphead', 'portal2.exe': 'Portal 2',
  'left4dead2.exe': 'Left 4 Dead 2', 'hl2.exe': 'Half-Life 2', 'tf_win64.exe': 'Team Fortress 2', 'deadlock.exe': 'Deadlock', 'pathofexile_x64.exe': 'Path of Exile',
  'pathofexile2.exe': 'Path of Exile 2', 'diablo iv.exe': 'Diablo IV', 'warframe.x64.exe': 'Warframe', 'standoff2.exe': 'Standoff 2', 'javaw.exe': 'Minecraft',
};
let gameIv = 0, lastGame = null;
export function findGame(list) {
  let weak = '';
  for (const n of list) { const g = GAMES[n]; if (!g) continue; if (n === 'javaw.exe') weak = g; else return g; }
  return weak;
}
async function scan() {
  if (!S.me || !prefs.gameScan) return;
  let list = [];
  try { list = await shell('hunty_procs'); } catch (_) { return; }
  const g = findGame(list || []);
  if (g === lastGame) return;
  lastGame = g;
  if (((S.me.profile || {}).game || '') === g) return;
  try { await api('profile_set', { game: g }); } catch (_) {}
}
function syncGame() {
  clearInterval(gameIv); gameIv = 0;
  if (!inTauri) return;
  if (prefs.gameScan) { gameIv = setInterval(scan, 20000); setTimeout(scan, 4000); }
  else if (S.me && (S.me.profile || {}).game) { lastGame = ''; api('profile_set', { game: '' }).catch(() => {}); }
}
if (inTauri) { syncGame(); bus.on('pref', k => { if (k === 'gameScan') syncGame(); }); }
