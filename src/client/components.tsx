import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardDefinition, Catalog, SessionView } from '../shared/types';
import { cardText } from './api';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    campaign: <><path d="M4 5h6l2 2 2-2h6v15h-6l-2 2-2-2H4z" /><path d="M12 7v15M7 9h2M7 13h2M15 9h2M15 13h2" /></>,
    standalone: <><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9"/><path d="m7 5 10 6"/></>,
    decks: <><path d="m6 8-3 1 3 13 9-2M10 5l-3 1 3 14 9-2M12 3h9v14h-9z"/><path d="m16.5 6 2 3-2 3-2-3z"/></>,
    history: <><path d="M4 8a9 9 0 1 1-1 8M4 3v5h5M12 7v6l4 2"/></>,
    credits: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></>,
    back: <><path d="m10 5-7 7 7 7M3 12h18"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m4 12 5 5L20 6"/>,
    plus: <path d="M12 4v16M4 12h16"/>,
    refresh: <><path d="M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-5M4 14a8 8 0 0 0 14 5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15c3 0 4 2 4 5"/></>,
    save: <><path d="M4 3h13l4 4v14H4zM8 3v6h8V3M8 21v-8h9v8"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/></>,
    link: <><path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 0-6-6l-5 5" transform="translate(3 3) scale(.8)"/></>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.credits}</svg>;
}

export function Sigil({ small = false }: { small?: boolean }) {
  return <svg className={`sigil ${small ? 'small' : ''}`} viewBox="0 0 140 140" fill="none" aria-hidden="true"><circle cx="70" cy="70" r="61"/><circle cx="70" cy="70" r="53"/><path d="m70 3 6 8-6 8-6-8zM70 121l6 8-6 8-6-8zM3 70l8-6 8 6-8 6zM121 70l8-6 8 6-8 6zM70 23 110 93H30zM70 117 30 47h80z"/><path d="M38 70s14-16 32-16 32 16 32 16-14 16-32 16-32-16-32-16Z"/><circle cx="70" cy="70" r="12"/><circle cx="70" cy="70" r="4"/><path d="M70 58V37M70 103V82M49 61 38 49M91 61l11-12M49 79 38 91M91 79l11 12"/></svg>;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); }; }, []);
  return <dialog className={`modal ${wide ? 'wide' : ''}`} ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}>
    <header className="modal-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></header><div className="modal-body">{children}</div>
  </dialog>;
}

export function EmptyState({ title, children, icon = 'campaign' }: { title: string; children?: ReactNode; icon?: string }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30}/></span><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function CardArt({ card, face = 'front', onClick, compact = false, selected = false, badge }: { card?: CardDefinition; face?: 'front'|'back'; onClick?: () => void; compact?: boolean; selected?: boolean; badge?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [card?.code, face]);
  const definition = card?.faces.find(f => f.id === face) || card?.faces[0];
  const body = <><div className="card-art-fallback"><span className="card-type">{card?.type.replace(/_/g, ' ') || 'Card'}</span><Sigil small/><strong>{definition?.name || card?.name || 'Unknown card'}</strong><span>{card?.code}</span></div>{card && !failed && <img loading="lazy" src={`/api/assets/${encodeURIComponent(card.code)}/${face}`} alt={definition?.name || card.name} onError={() => setFailed(true)}/>}<span className="card-surface-title">{definition?.name || card?.name || 'Unknown card'}</span> {badge && <span className="card-badge">{badge}</span>}{selected && <span className="selection-mark"><Icon name="check" size={16}/></span>}</>;
  return onClick ? <button type="button" className={`card-art ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`} onClick={onClick} title={definition?.name || card?.name} aria-label={`Inspect ${definition?.name || card?.name || 'card'}`}>{body}</button> : <div className={`card-art ${compact ? 'compact' : ''}`}>{body}</div>;
}

export function InstanceCard({ id, session, catalog, inspect, compact, badge }: { id: string; session: SessionView; catalog: Catalog; inspect: (code: string, face?: 'front'|'back') => void; compact?: boolean; badge?: string }) {
  const instance = session.cards[id];
  if (!instance) return <span className="muted">Hidden card</span>;
  return <CardArt card={catalog.cards[instance.code]} face={instance.face} compact={compact} badge={badge} onClick={() => inspect(instance.code, instance.face)}/>;
}

export function CardInspector({ code, face: initialFace, catalog, onClose }: { code: string; face?: 'front'|'back'; catalog: Catalog; onClose: () => void }) {
  const [face, setFace] = useState(initialFace || 'front');
  const card = catalog.cards[code];
  const definition = card?.faces.find(f => f.id === face) || card?.faces[0];
  if (!card) return <Modal title="Card unavailable" onClose={onClose}><p>Card {code} is outside the supported catalog.</p></Modal>;
  return <Modal title={definition?.name || card.name} eyebrow={`${card.type.replace(/_/g, ' ')} · ${card.code}`} onClose={onClose} wide><div className="card-inspector"><CardArt card={card} face={face}/><div><div className="tags"><span className={`tag faction-${card.faction}`}>{card.faction}</span>{card.subtype && <span className="tag">{card.subtype}</span>}</div>{!initialFace && card.faces.length > 1 && <div className="segmented face-toggle">{card.faces.map(f => <button key={f.id} aria-pressed={face === f.id} className={face === f.id ? 'active' : ''} onClick={() => setFace(f.id)}>{f.id === 'front' ? 'Front' : 'Reverse'}</button>)}</div>}{card.raw.taboo_text?<p className="inline-info">ArkhamDB Taboo: {String(card.raw.taboo_text)}</p>:null}{catalog.rules&&<p className="fine-print">Effective ArkhamDB rules · Taboo {catalog.rules.tabooDate} (ID {catalog.rules.tabooId}) · {catalog.rules.scriptVersion}. Artwork may show earlier printed text.</p>}{typeof card.raw.xp==='number'&&<p className="fine-print">Printed level {card.raw.xp} · Purchase XP {Math.max(0,Number(card.raw.xp)*(card.raw.exceptional?2:1)+Number(card.raw.taboo_xp??0))}{card.raw.taboo_forbidden?' · Forbidden':''}</p>}<p className="rules-text">{cardText(definition?.text || '') || 'No rules text on this face.'}</p>{(card.health !== undefined || card.sanity !== undefined) && <div className="stat-row"><span>Health <b>{card.health ?? '—'}</b></span><span>Sanity <b>{card.sanity ?? '—'}</b></span></div>}<p className="fine-print">Chapter Two core set · Artwork cached on this server</p></div></div></Modal>;
}
