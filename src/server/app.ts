import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import { BUILD_VERSION, type Catalog, type Viewer, type GameCommand, type SetupOptions } from '../shared/types.js';
import { createGame, applyCommand, projectState } from '../game/setup.js';
import { Storage, AppError, type Checkpoint } from './storage.js';
import { AssetManager } from './assets.js';
import { deckUrl, fetchDeck } from './deck-import.js';
import { fetchLatestRules, RulesUpdateRequired, type RulesPackage } from './rules.js';
import { createPilot } from '../game/pilot.js';
import { Tunnel } from './tunnel.js';

const idSchema = z.string().min(1).max(100);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const actionSchema = z.object({ expectedRevision: revisionSchema, commandId: z.string().uuid() });
const logRecordSchema = z.object({ experience:z.number().int().min(0).max(999), physicalTrauma:z.number().int().min(0).max(99), mentalTrauma:z.number().int().min(0).max(99), notes:z.string().max(10000) });
const commandSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('mulligan'),investigatorId:idSchema,cardIds:z.array(idSchema).max(5)}),
  z.object({type:z.literal('action'),investigatorId:idSchema,actionId:z.string().max(500)}),
  z.object({type:z.literal('choose'),investigatorId:idSchema,choiceId:idSchema,optionIds:z.array(z.string().max(500)).max(100)}),
  z.object({type:z.literal('pass'),investigatorId:idSchema,choiceId:idSchema}),
  z.object({type:z.literal('campaign-log'),entries:z.string().max(100000),records:z.record(z.string().max(100),logRecordSchema)})
]);
export interface AppOptions {
  appDir: string; dataDir: string; catalog: Catalog; port?: number; hostToken?: string; logger?: boolean;
  pilot?: boolean; rulesFetcher?: (catalog:Catalog)=>Promise<RulesPackage>;
  deckFetcher?: typeof fetchDeck; assetManager?: AssetManager; onShutdown?: () => void;
}
export async function createApp(options: AppOptions) {
  const app = Fastify({ bodyLimit:40*1024*1024, logger: options.logger ? {redact:['req.headers.authorization','req.headers.sec-websocket-protocol']} : false });
  const storage = new Storage(options.dataDir, options.catalog);
  const assets = options.assetManager ?? new AssetManager(options.dataDir, options.catalog);
  void assets.install();
  const hostToken = options.hostToken ?? randomBytes(32).toString('base64url');
  const tunnel = new Tunnel(options.appDir, options.port ?? 4917);
  const clients = new Map<WebSocket, {token:string;sessionId:string;alive:boolean}>();
  const importingDecks = new Set<string>();
  const verifyLatestRules=async()=>{
    try {const rules=await (options.rulesFetcher??fetchLatestRules)(options.catalog);storage.storeRules(rules);return rules;}
    catch(error){if(error instanceof RulesUpdateRequired)storage.requireRulesUpdate(error.message);throw error;}
  };
  const authenticate = (token: string): Viewer | null => {
    const supplied = Buffer.from(token), expected = Buffer.from(hostToken);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return {role:'host'};
    if (token.length < 20 || token.length > 200) return null;
    return storage.invitation(token);
  };
  const requestToken = (req:FastifyRequest):string => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return '';
  };
  const viewerFor = (req:FastifyRequest, hostOnly=false):Viewer => {
    const viewer = authenticate(requestToken(req));
    if (!viewer) throw new AppError('Open the application from its launcher or use a player invitation to connect.',401);
    if (hostOnly && viewer.role !== 'host') throw new AppError('Only the host can perform this action.',403);
    return viewer;
  };
  const sessionAccess = (req:FastifyRequest, hostOnly=false):{viewer:Viewer;id:string} => {
    const viewer = viewerFor(req,hostOnly);
    const id = idSchema.parse((req.params as {id:string}).id);
    if (viewer.role === 'player' && viewer.sessionId !== id) throw new AppError('This invitation is for a different campaign.',403);
    return {viewer,id};
  };
  const present = (cp:Checkpoint, viewer:Viewer) => projectState(cp.state, viewer, cp.id,cp.state.rules.id==='legacy-setup-v1'?options.catalog:storage.getRules(cp.state.rules.id).catalog);
  const broadcast = (sessionId:string) => {
    const cp = storage.current(sessionId);
    for (const [socket, client] of clients) {
      if (client.sessionId !== sessionId || socket.readyState !== 1) continue;
      const viewer = authenticate(client.token);
      if (!viewer) {socket.close(4001,'Invitation revoked');continue;}
      socket.send(JSON.stringify({type:'state',state:present(cp,viewer)}));
    }
  };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({error:'Invalid request: '+error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).slice(0,3).join('; ')});
    if (error instanceof AppError) return reply.code(error.statusCode).send({error:error.message});
    const e = error as Error & {statusCode?:number};
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({error:e.message});
    app.log.error(e);
    return reply.code(500).send({error:'The operation could not be completed. Your last committed checkpoint is safe.'});
  });
  app.addHook('onSend', async (_req,reply,payload) => {
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
    if (reply.getHeader('content-type')?.toString().includes('application/json')) reply.header('Cache-Control','no-store');
    return payload;
  });
  app.addHook('onRequest',async req=>{if(/^\/api\/(sessions|saves|import|pilot|ws)(?:[/?]|$)/.test(req.url)&&!assets.status().installed)throw new AppError('Complete artwork installation before opening a table.',503);});
  app.addContentTypeParser('application/octet-stream', {parseAs:'buffer'}, (_req,body,done) => done(null,body));
  await app.register(websocket, { options: {maxPayload:8192,handleProtocols:protocols => protocols.has('arkham-v1') ? 'arkham-v1' : false} });
  app.get('/api/health', async () => ({ok:true,version:BUILD_VERSION}));
  app.post('/api/auth', async req => {
    const body = z.object({hostToken:z.string().max(200).optional(),joinToken:z.string().max(200).optional()}).parse(req.body);
    const token = body.hostToken ?? body.joinToken ?? '';
    const viewer = authenticate(token);
    if (!viewer) throw new AppError('This connection link has expired or is invalid. Request a new link from the host.',401);
    return {viewer,token};
  });
  app.get('/api/bootstrap', async req => {
    const viewer = authenticate(requestToken(req));
    const sessions = viewer ? storage.listSessions().filter(s => viewer.role==='host' || s.id===viewer.sessionId) : [];
    return {version:BUILD_VERSION,pilot:!!options.pilot,viewer,sessions,activeSessionId:viewer?.sessionId ?? sessions[0]?.id ?? null};
  });
  app.get('/api/catalog', async req => {const id=(req.query as {rules?:string}).rules;return id==='legacy-setup-v1'?options.catalog:id?storage.getRules(id).catalog:storage.latestRules().catalog;});
  app.get('/api/decks', async req => {viewerFor(req,true);return storage.listDecks().map(d=>({...d,sourceProblem:storage.rulesProblem()??d.sourceProblem??(!d.rules||d.rules.id!==storage.latestRules().identity.id?'Refresh this deck with the latest ArkhamDB Taboo.':undefined)}));});
  app.post('/api/decks', async req => {
    viewerFor(req,true);
    const body=z.object({source:z.enum(['published','shared']),code:z.string().trim().min(1).max(100)}).parse(req.body);
    let code:string;
    try {code=deckUrl(body.source,body.code).code;} catch(error) {throw new AppError((error as Error).message);}
    const existing = storage.findDeck(body.source,code);

    const key = `${body.source}:${code}`;
    if (importingDecks.has(key)) throw new AppError('That deck is already being imported. Please wait.',409);
    importingDecks.add(key);
    try {
      const rules=await verifyLatestRules();
      const deck = await (options.deckFetcher ?? fetchDeck)(body.source,code,options.catalog,{libraryId:existing?.libraryId??randomUUID(),revision:(existing?.revision??0)+1},rules);
      storage.storeDeck(deck);return deck;
    } catch(error) {if(error instanceof AppError) throw error;throw new AppError((error as Error).message,422);}
    finally {importingDecks.delete(key);}
  });
  app.post('/api/decks/:id/refresh', async req => {
    viewerFor(req,true);const deck=storage.getLibraryDeck((req.params as {id:string}).id);
    const key=`${deck.source}:${deck.sourceCode}`;
    if(importingDecks.has(key)) throw new AppError('That deck is already being refreshed.',409);
    importingDecks.add(key);
    try {
      const rules=await verifyLatestRules();
      const revision = await (options.deckFetcher ?? fetchDeck)(deck.source,deck.sourceCode,options.catalog,{libraryId:deck.libraryId,revision:deck.revision+1},rules);
      storage.storeDeck(revision);return revision;
    } catch(error) {if(error instanceof AppError) throw error;throw new AppError((error as Error).message,422);}
    finally {importingDecks.delete(key);}
  });
  app.delete('/api/decks/:id', async req => {viewerFor(req,true);storage.removeDeck((req.params as {id:string}).id);return {ok:true};});
  app.post('/api/sessions', async req => {
    const viewer=viewerFor(req,true);
    if(storage.rulesProblem())throw new AppError(storage.rulesProblem()!,422);
    const body=z.object({name:z.string().trim().min(1).max(100),mode:z.enum(['hotseat','separate']),difficulty:z.enum(['easy','standard','hard','expert']),leadSeat:z.number().int().min(1).max(4),seats:z.array(z.object({deckRevisionId:idSchema,playerName:z.string().trim().min(1).max(60)})).min(1).max(4),logEntries:z.string().max(100000).optional()}).parse(req.body);
    const decks=body.seats.map(s=>storage.getDeckRevision(s.deckRevisionId));
    const setup:SetupOptions={...body,sessionId:randomUUID(),createdAt:new Date().toISOString(),seed:randomBytes(4).readUInt32LE()};
    let state;
    try {state=createGame(setup,storage.latestRules().catalog,decks,storage.latestRules().identity);}catch(e){throw new AppError((e as Error).message);}
    return present(storage.createSession(state,{type:'setup',options:setup}),viewer);
  });
  if(options.pilot)app.post('/api/pilot',async req=>{
    const viewer=viewerFor(req,true);const body=z.object({fixture:z.enum(['opening','locations']).default('opening')}).parse(req.body??{});
    const rules=storage.latestRules();const {state,decks}=createPilot(rules.catalog,rules.identity,body.fixture);
    return storage.db.transaction(()=>{decks.forEach(d=>storage.storeDeck(d));return present(storage.createSession(state,{type:'pilot-fixture',fixture:body.fixture}),viewer);})();
  });
  app.get('/api/sessions/:id', async req => {const {id,viewer}=sessionAccess(req);return present(storage.resume(id),viewer);});
  app.post('/api/sessions/:id/commands', async req => {
    const {id,viewer}=sessionAccess(req);
    const body=actionSchema.extend({command:commandSchema}).parse(req.body);
    if (viewer.role==='player' && (body.command.type==='campaign-log' || body.command.investigatorId!==viewer.investigatorId)) throw new AppError('You can only control your assigned investigator.',403);
    const command=body.command as GameCommand;
    const label=command.type==='campaign-log' ? 'Campaign log updated' : command.type!=='mulligan'? 'Player decision: '+command.type : `${storage.current(id).state.investigators.find(i=>i.id===command.investigatorId)?.name ?? 'Investigator'} kept an opening hand`;
    const cp=storage.apply(id,body.commandId,body.expectedRevision,command,label,(state,boundary)=>{
      if(state.engine.pilot&&!options.pilot)throw new AppError('Open this save in the developer pilot.');
      try{return applyCommand(state,command,state.rules.id==='legacy-setup-v1'?options.catalog:storage.getRules(state.rules.id).catalog,boundary);}catch(e){throw new AppError((e as Error).message);}
    });
    broadcast(id);return present(cp,viewer);
  });
  app.get('/api/sessions/:id/history', async req => {const {id}=sessionAccess(req,true);return storage.history(id);});
  app.post('/api/sessions/:id/rollback', async req => {
    const {id,viewer}=sessionAccess(req,true);const body=actionSchema.extend({checkpointId:idSchema}).parse(req.body);
    storage.rollback(id,body.checkpointId,body.expectedRevision,body.commandId);const cp=storage.resume(id);broadcast(id);return present(cp,viewer);
  });
  app.post('/api/sessions/:id/undo', async req => {
    const {id,viewer}=sessionAccess(req,true);const body=actionSchema.parse(req.body);
    storage.undo(id,body.expectedRevision,body.commandId);const cp=storage.resume(id);broadcast(id);return present(cp,viewer);
  });
  app.get('/api/saves', async req => {viewerFor(req,true);return storage.listSaves();});
  app.post('/api/sessions/:id/saves', async req => {const {id}=sessionAccess(req,true);const body=z.object({name:z.string().trim().min(1).max(100)}).parse(req.body);return storage.save(id,body.name);});
  app.post('/api/saves/:id/load', async req => {const viewer=viewerFor(req,true);const saved=storage.loadSave((req.params as {id:string}).id);const cp=storage.resume(saved.state.sessionId);broadcast(cp.state.sessionId);return present(cp,viewer);});
  app.get('/api/sessions/:id/export', async (req,reply) => {const {id}=sessionAccess(req,true);return reply.header('Content-Disposition',`attachment; filename="arkham-${id.slice(0,8)}.arkham-save"`).type('application/octet-stream').send(storage.exportSession(id));});
  app.post('/api/import', async req => {const viewer=viewerFor(req,true);if(!Buffer.isBuffer(req.body))throw new AppError('Choose an .arkham-save archive.');const cp=storage.importSession(req.body,!!options.pilot);return present(storage.resume(cp.state.sessionId),viewer);});
  app.post('/api/sessions/:id/invites', async req => {
    const {id}=sessionAccess(req,true);const cp=storage.current(id);
    const seats=cp.state.investigators.map(i=>{const token=randomBytes(32).toString('base64url');return {investigatorId:i.id,name:i.name,token,path:`/#join=${token}`};});
    storage.setInvitations(id,seats);broadcast(id);return {seats};
  });
  app.get('/api/assets/status', async () => assets.status());
  app.post('/api/assets/download', async req => {viewerFor(req,true);return assets.downloadAll();});
  app.get('/api/assets/:code/:face', async (req,reply) => {
    const {code,face}=z.object({code:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),face:z.enum(['front','back'])}).parse(req.params);
    if (!options.catalog.cards[code]?.faces.some(cardFace => cardFace.id === face)) throw new AppError('That card face was not found.',404);
    const result=await assets.get(code,face);
    return reply.header('Cache-Control',result.placeholder?'no-store':'public, max-age=86400').type(result.contentType).send(result.bytes);
  });
  app.get('/api/tunnel', async req => {viewerFor(req,true);return tunnel.status();});
  app.post('/api/tunnel', async req => {viewerFor(req,true);const body=z.object({action:z.enum(['start','stop'])}).parse(req.body);return body.action==='start'?tunnel.start():tunnel.stop();});
  app.post('/api/shutdown', async req => {viewerFor(req,true);setTimeout(()=>options.onShutdown?.(),150).unref();return {ok:true};});
  app.get('/api/ws', {websocket:true,preValidation:async(req,reply)=>{
    const token=(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim()).find(s=>s.startsWith('arkham-auth.'))?.slice(12)??'';
    const viewer=authenticate(token);const sid=(req.query as {sessionId?:string}).sessionId;
    if(!viewer||!sid||(viewer.role==='player'&&viewer.sessionId!==sid)){await reply.code(401).send({error:'Invalid player connection.'});return;}
    storage.resume(sid);
  }}, (socket,req)=>{
    const token=(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim()).find(s=>s.startsWith('arkham-auth.'))!.slice(12);
    const sessionId=(req.query as {sessionId:string}).sessionId;
    clients.set(socket,{token,sessionId,alive:true});
    socket.on('pong',()=>{const c=clients.get(socket);if(c)c.alive=true;});
    socket.on('error',()=>clients.delete(socket));socket.on('close',()=>clients.delete(socket));
    socket.send(JSON.stringify({type:'state',state:present(storage.current(sessionId),authenticate(token)!)}));
  });
  const heartbeat=setInterval(()=>{
    for(const [socket,client]of clients){if(!client.alive||!authenticate(client.token)){socket.terminate();clients.delete(socket);continue;}client.alive=false;socket.ping();}
  },20000);heartbeat.unref();
  const clientDir=join(options.appDir,'dist','client');
  if(existsSync(clientDir)){
    await app.register(fastifyStatic,{root:clientDir,prefix:'/'});
    app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'API route not found.'}):reply.sendFile('index.html'));
  }else app.get('/',async(_req,reply)=>reply.type('text/html').send('<h1>Arkham Horror Digital</h1><p>Run npm run build, then restart the server. For development, run npm run dev:ui.</p>'));
  app.addHook('onClose',async()=>{clearInterval(heartbeat);for(const socket of clients.keys())socket.terminate();clients.clear();tunnel.stop();assets.close();storage.close();});
  return {app,storage,assets,hostToken,tunnel,broadcast};
}
