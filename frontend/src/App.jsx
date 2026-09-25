// RetailMind AI — every screen is connected to the real FastAPI backend:
// auth, inventory/shelf-fill, alerts, procurement, forecast (Prophet/XGBoost/
// LSTM/attention-based "TFT"), analytics, team, tasks, the assistant,
// warehouse (zones/pick-route/congestion/staffing), and the customer app
// (catalog/scan, shopping list, checkout, offers, recommendations) all hit
// live Postgres data. See README for what's still out of scope (a live CV/
// camera pipeline, Flutter, cloud deployment) and why.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Leaf, Mail, Lock, Bell, ScanLine, ChevronRight, Gift, Snowflake, Tag,
  ClipboardList, Video, TrendingUp, Users, Home, User, LogOut, Building2,
  Store, UserPlus, X, ShieldCheck, MapPin, Sparkles, RefreshCw,
  Apple, Milk, Wheat, Beef, CreditCard, Clock, Truck, MessageCircle, Send, BarChart3, Package,
  Loader2, AlertTriangle, Menu, Banknote, Wallet, Smartphone, ShoppingCart, Plus, Minus, Receipt, ChevronLeft, Check,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { apiFetch, ApiError, UNAUTHORIZED_EVENT } from "./api";

/* ----------------------------- design tokens / css ----------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap');

.rm-outer{ min-height:100vh; width:100%; background:radial-gradient(circle at 20% 0%, #EDF3EC 0%, #E3E9DF 45%, #D9E1D6 100%); box-sizing:border-box; }
.rm-root, .rm-root *{ box-sizing:border-box; }
.rm-root{ --ink:#16201A; --ink-soft:#5B665D; --paper:#F6F4EC; --paper-raised:#FFFFFF; --green:#2E7D4F; --green-deep:#163B27; --green-pale:#E4EFE3; --amber:#C9791E; --amber-pale:#FBEEDC; --red:#B93A2C; --red-pale:#FAE6E2; --blue:#376C93; --blue-pale:#E4EEF3; --plum:#7D5A85; --plum-pale:#F1E8F0; --line:rgba(22,32,26,0.11); font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:var(--ink); }
.rm-display{ font-family:'Fraunces',Georgia,serif; }

/* ---- desktop app shell ---- */
.rm-shell{ min-height:100vh; width:100%; display:flex; align-items:stretch; }

.rm-sidebar{ width:256px; flex:0 0 auto; background:var(--paper-raised); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:22px 16px; position:sticky; top:0; height:100vh; }
.rm-sidebar-brand{ display:flex; align-items:center; gap:11px; padding:2px 8px 24px; }
.rm-sidebar-brand .mark{ width:36px; height:36px; border-radius:11px; background:var(--green); display:flex; align-items:center; justify-content:center; flex:0 0 auto; box-shadow:0 8px 16px -8px rgba(46,125,79,0.55); }
.rm-sidebar-brand-name{ font-size:16.5px; font-weight:700; line-height:1.1; }
.rm-sidebar-brand-tag{ font-size:10.5px; color:var(--ink-soft); font-weight:600; margin-top:1px; }
.rm-sidebar-section{ font-size:10.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#6B7368; padding:14px 12px 8px; }
.rm-sidebar-nav{ display:flex; flex-direction:column; gap:2px; flex:1 1 auto; overflow-y:auto; }
.rm-sidebar-footer{ border-top:1px solid var(--line); padding-top:14px; margin-top:10px; display:flex; align-items:center; gap:10px; }
.rm-sidebar-footer-mid{ flex:1; min-width:0; }
.rm-sidebar-footer-name{ font-weight:800; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rm-sidebar-footer-sub{ font-size:10.5px; color:var(--ink-soft); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rm-sidebar-signout{ border:none; background:var(--paper); width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink-soft); flex:0 0 auto; }

.rm-tab{ display:flex; align-items:center; gap:12px; background:none; border:none; color:var(--ink-soft); font-size:13.5px; font-weight:700; padding:11px 12px; cursor:pointer; font-family:inherit; border-radius:12px; text-align:left; width:100%; }
.rm-tab.active{ color:#1F5C39; background:var(--green-pale); }

.rm-main{ flex:1 1 auto; min-width:0; height:100vh; display:flex; flex-direction:column; }
.rm-scroll{ flex:1 1 auto; overflow-y:auto; }
.rm-scroll::-webkit-scrollbar{ width:8px; }
.rm-scroll::-webkit-scrollbar-thumb{ background:rgba(22,32,26,0.14); border-radius:8px; }
.rm-screen{ max-width:1180px; margin:0 auto; width:100%; padding:34px 40px 72px; }

.rm-login-outer{ min-height:100vh; width:100%; display:flex; align-items:center; justify-content:center; padding:32px 16px; }
.rm-login-card{ width:420px; max-width:100%; background:var(--paper-raised); border:1px solid var(--line); border-radius:24px; padding:38px 34px 30px; box-shadow:0 30px 60px -30px rgba(15,20,15,0.35); }

@media (max-width:860px){
  .rm-shell{ flex-direction:column; }
  .rm-sidebar{ position:sticky; top:0; z-index:30; width:100%; height:auto; flex-direction:row; align-items:center; padding:12px 14px; overflow-x:auto; border-right:none; border-bottom:1px solid var(--line); }
  .rm-sidebar-brand{ padding:2px 10px 2px 2px; }
  .rm-sidebar-section{ display:none; }
  .rm-sidebar-nav{ flex-direction:row; overflow-x:auto; flex:0 0 auto; }
  .rm-tab{ flex-direction:column; gap:3px; font-size:10.5px; padding:8px 10px; white-space:nowrap; }
  .rm-sidebar-footer{ border-top:none; border-left:1px solid var(--line); padding:0 0 0 12px; margin:0 0 0 8px; }
  .rm-sidebar-footer-mid{ display:none; }
  .rm-main{ height:auto; }
  .rm-scroll{ overflow-y:visible; }
  .rm-screen{ padding:22px 18px 48px; }
}

.rm-btn-primary{ display:flex; align-items:center; justify-content:center; gap:8px; background:var(--green); color:#fff; border:none; border-radius:15px; padding:14px 18px; font-weight:700; font-size:14.5px; cursor:pointer; font-family:inherit; }
.rm-btn-ghost{ display:flex; align-items:center; justify-content:center; gap:8px; background:var(--paper-raised); border:1.5px solid var(--line); border-radius:15px; padding:12.5px 18px; font-weight:700; font-size:14px; color:var(--ink); cursor:pointer; font-family:inherit; }
.rm-w100{ width:100%; margin-top:10px; }
.rm-root input, .rm-root select{ font-family:inherit; }
.rm-root input[type=checkbox], .rm-root input[type=radio]{ accent-color:var(--green); width:18px; height:18px; flex:0 0 auto; }
.rm-input{ border:none; outline:none; background:transparent; font-size:14.5px; color:var(--ink); flex:1; padding:13px 4px; font-weight:600; }
.rm-input.full{ width:100%; background:var(--paper); border:1.5px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:10px; font-weight:600; outline:none; }
.rm-input.full:focus{ border-color:var(--green); box-shadow:0 0 0 3px var(--green-pale); }
.rm-field{ display:flex; align-items:center; gap:10px; background:var(--paper-raised); border:1.5px solid var(--line); border-radius:14px; padding:0 14px; margin-bottom:10px; }

.rm-login{ padding-top:18px; }
.rm-login-top{ display:flex; flex-direction:column; align-items:center; margin-bottom:22px; }
.rm-brandmark{ width:52px; height:52px; border-radius:16px; background:var(--green); display:flex; align-items:center; justify-content:center; margin-bottom:12px; box-shadow:0 10px 20px -8px rgba(46,125,79,0.55); }
.rm-login-title{ font-size:26px; font-weight:700; }
.rm-login-tag{ font-size:13px; color:var(--ink-soft); margin-top:3px; font-weight:600; }
.rm-seg{ display:flex; background:var(--paper-raised); border:1.5px solid var(--line); border-radius:13px; padding:4px; margin-bottom:14px; gap:4px; }
.rm-seg.small{ margin-bottom:0; }
.rm-seg-btn{ flex:1; border:none; background:transparent; padding:9px 8px; border-radius:9px; font-weight:700; font-size:13px; color:var(--ink-soft); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-family:inherit; }
.rm-seg-btn.active{ background:var(--green); color:#fff; }
.rm-preview-picker{ margin:4px 0 14px; }
.rm-preview-label{ font-size:12px; font-weight:700; color:var(--ink-soft); margin-bottom:6px; }
.rm-divider{ text-align:center; margin:16px 0; position:relative; color:#A2A99D; font-size:12px; font-weight:700; }
.rm-divider::before, .rm-divider::after{ content:''; position:absolute; top:50%; width:40%; height:1px; background:var(--line); }
.rm-divider::before{ left:0; } .rm-divider::after{ right:0; }
.rm-divider span{ background:var(--paper); padding:0 10px; position:relative; }
.rm-login-caption{ text-align:center; font-size:11.5px; color:var(--ink-soft); margin-top:16px; line-height:1.5; font-weight:600; }

/* ---- marketing front page (before login) ---- */
.rm-landing{ background:var(--paper); min-height:100vh; }
.rm-landing-nav{ position:sticky; top:0; z-index:50; background:rgba(246,244,236,0.88); backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
.rm-landing-nav-inner{ max-width:1240px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 48px; }
.rm-landing-menu-btn{ display:none; align-items:center; justify-content:center; width:38px; height:38px; border-radius:11px; border:1.5px solid var(--line); background:var(--paper-raised); color:var(--ink); cursor:pointer; }
.rm-landing-mobile-menu{ display:flex; flex-direction:column; padding:6px 18px 14px; border-top:1px solid var(--line); }
.rm-landing-mobile-menu a{ padding:12px 4px; font-size:14px; font-weight:700; color:var(--ink); text-decoration:none; border-bottom:1px solid var(--line); }
.rm-landing-mobile-menu a:last-child{ border-bottom:none; }
.rm-landing-nav-brand{ display:flex; align-items:center; gap:10px; }
.rm-landing-nav-brand .mark{ width:34px; height:34px; border-radius:10px; background:var(--green); display:flex; align-items:center; justify-content:center; flex:0 0 auto; box-shadow:0 8px 16px -8px rgba(46,125,79,0.55); }
.rm-landing-nav-name{ font-size:16px; font-weight:800; }
.rm-landing-nav-links{ display:flex; align-items:center; gap:30px; }
.rm-landing-nav-links a{ font-size:13px; font-weight:700; color:var(--ink-soft); text-decoration:none; cursor:pointer; }
.rm-landing-nav-links a:hover{ color:var(--ink); }
.rm-landing-nav-cta{ display:flex; align-items:center; gap:10px; }
.rm-landing-nav-cta .rm-btn-ghost, .rm-landing-nav-cta .rm-btn-primary{ padding:9px 16px; font-size:13px; border-radius:11px; }

.rm-landing-hero{ max-width:1240px; margin:0 auto; padding:64px 48px 40px; display:grid; grid-template-columns:1fr 1fr; gap:56px; align-items:center; }
.rm-eyebrow{ font-size:11.5px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--green-deep); background:var(--green-pale); display:inline-flex; padding:6px 12px; border-radius:20px; margin-bottom:18px; }
.rm-landing-h1{ font-size:46px; line-height:1.1; font-weight:600; margin:0 0 18px; }
.rm-landing-h1 em{ font-style:italic; color:var(--green-deep); }
.rm-landing-sub{ font-size:16px; line-height:1.6; color:var(--ink-soft); font-weight:500; max-width:460px; margin:0 0 28px; }
.rm-landing-cta-row{ display:flex; gap:12px; align-items:center; margin-bottom:18px; flex-wrap:wrap; }
.rm-landing-cta-row .rm-btn-primary, .rm-landing-cta-row .rm-btn-ghost{ padding:14px 22px; }
.rm-landing-microcopy{ font-size:12px; color:var(--ink-soft); font-weight:600; }

.rm-hero-collage{ position:relative; height:420px; }
.rm-hero-photo{ position:absolute; border-radius:20px; object-fit:cover; box-shadow:0 24px 48px -20px rgba(15,20,15,.35); border:5px solid var(--paper-raised); }
.rm-hero-photo.p1{ width:62%; height:78%; top:0; right:0; }
.rm-hero-photo.p2{ width:46%; height:52%; bottom:0; left:0; z-index:2; }
.rm-hero-photo.p3{ width:34%; height:38%; top:6%; left:2%; z-index:3; }

.rm-landing-section{ max-width:1180px; margin:0 auto; padding:60px 48px; }
.rm-landing-section-head{ text-align:center; max-width:620px; margin:0 auto 40px; }
.rm-landing-section-head .rm-eyebrow{ margin-left:auto; margin-right:auto; }
.rm-landing-h2{ font-size:30px; font-weight:600; margin:0 0 12px; }
.rm-landing-p{ font-size:14.5px; color:var(--ink-soft); font-weight:500; line-height:1.6; margin:0; }

.rm-feature-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:18px; }
.rm-feature-card{ background:var(--paper-raised); border:1px solid var(--line); border-radius:18px; padding:24px 20px; }
.rm-feature-card .ic{ width:40px; height:40px; border-radius:12px; background:var(--green-pale); display:flex; align-items:center; justify-content:center; margin-bottom:14px; color:var(--green-deep); }
.rm-feature-card h3{ font-size:14.5px; margin:0 0 6px; font-weight:800; }
.rm-feature-card p{ font-size:12.5px; color:var(--ink-soft); font-weight:600; line-height:1.55; margin:0; }

.rm-photo-trio{ display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }
.rm-photo-card{ position:relative; border-radius:20px; overflow:hidden; height:300px; box-shadow:0 20px 40px -22px rgba(15,20,15,.4); }
.rm-photo-card img{ width:100%; height:100%; object-fit:cover; display:block; transition:transform .4s ease; }
.rm-photo-card:hover img{ transform:scale(1.05); }
.rm-photo-card-label{ position:absolute; left:0; right:0; bottom:0; padding:18px 18px 16px; background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(10,16,11,.78) 100%); color:#fff; }
.rm-photo-card-label .tag{ font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; opacity:.85; margin-bottom:4px; }
.rm-photo-card-label .ti{ font-size:19px; font-weight:600; }

.rm-cta-band{ max-width:1180px; margin:0 auto 60px; background:var(--green-deep); border-radius:28px; padding:48px 56px; display:flex; align-items:center; justify-content:space-between; gap:24px; color:#fff; }
.rm-cta-band h3{ font-size:26px; font-weight:600; margin:0 0 6px; }
.rm-cta-band p{ font-size:13.5px; opacity:.82; margin:0; font-weight:500; }
.rm-cta-band .rm-btn-primary{ background:#fff; color:var(--green-deep); flex:0 0 auto; }

.rm-landing-footer{ border-top:1px solid var(--line); padding:44px 48px 26px; }
.rm-landing-footer-inner{ max-width:1180px; margin:0 auto; display:flex; justify-content:space-between; gap:40px; flex-wrap:wrap; }
.rm-footer-brand p{ font-size:12px; color:var(--ink-soft); font-weight:600; max-width:230px; line-height:1.5; margin:10px 0 0; }
.rm-footer-cols{ display:flex; gap:56px; flex-wrap:wrap; }
.rm-footer-col .h{ font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:12px; font-size:10.5px; }
.rm-footer-col a{ display:block; font-size:12.5px; font-weight:700; color:var(--ink); text-decoration:none; margin-bottom:9px; cursor:pointer; }
.rm-footer-bottom{ max-width:1180px; margin:26px auto 0; padding-top:18px; border-top:1px solid var(--line); font-size:11px; color:var(--ink-soft); font-weight:600; }
.rm-landing [id]{ scroll-margin-top:88px; }
html:has(.rm-landing){ scroll-behavior:smooth; }
.rm-footer-link{ display:block; background:none; border:none; padding:0; margin-bottom:9px; font:inherit; font-size:12.5px; font-weight:700; color:var(--ink); cursor:pointer; text-align:left; }
.rm-footer-link:hover{ color:var(--green); }
a.rm-btn-ghost{ text-decoration:none; }
.rm-hero-photo, .rm-photo-card{ background:var(--green-pale); }
.rm-field:focus-within{ border-color:var(--green); box-shadow:0 0 0 3px var(--green-pale); }
.rm-landing button:focus-visible, .rm-landing a:focus-visible, .rm-landing summary:focus-visible{ outline:2px solid var(--green); outline-offset:3px; }
@media (prefers-reduced-motion:reduce){
  html:has(.rm-landing){ scroll-behavior:auto; }
  .rm-landing *, .rm-landing *::before, .rm-landing *::after{ animation:none !important; transition:none !important; }
}
.rm-back-link{ background:none; border:none; cursor:pointer; display:flex; align-items:center; gap:6px; color:var(--ink-soft); font-weight:700; font-size:13px; margin-bottom:12px; font-family:inherit; padding:0; }

@media (max-width:900px){
  .rm-landing-nav-inner{ padding:14px 18px; }
  .rm-landing-nav-links{ display:none; }
  .rm-landing-menu-btn{ display:flex; }
  .rm-landing-hero{ grid-template-columns:1fr; padding:36px 20px; }
  .rm-hero-collage{ height:300px; margin-top:10px; }
  .rm-landing-section{ padding:44px 20px; }
  .rm-feature-grid{ grid-template-columns:1fr 1fr; }
  .rm-photo-trio{ grid-template-columns:1fr; }
  .rm-photo-card{ height:220px; }
  .rm-cta-band{ flex-direction:column; text-align:center; padding:36px 26px; margin-left:20px; margin-right:20px; }
  .rm-landing-footer{ padding:36px 20px 22px; }
  .rm-landing-footer-inner{ flex-direction:column; gap:28px; }
}
@media (max-width:600px){
  .rm-feature-grid{ grid-template-columns:1fr; }
  .rm-landing-h1{ font-size:34px; }
}

.rm-topbar{ display:flex; align-items:flex-start; justify-content:space-between; padding:14px 0 16px; }
.rm-topbar-title{ font-size:22px; font-weight:700; }
.rm-topbar-sub{ font-size:12.5px; color:var(--ink-soft); font-weight:600; margin-top:2px; }
.rm-topbar-icon{ width:38px; height:38px; border-radius:12px; background:var(--paper-raised); border:1px solid var(--line); display:flex; align-items:center; justify-content:center; position:relative; flex:0 0 auto; }
.rm-bell-wrap{ position:relative; display:flex; }
.rm-bell-dot{ position:absolute; top:-6px; right:-7px; background:var(--red); color:#fff; font-size:9.5px; font-weight:800; min-width:15px; height:15px; border-radius:8px; display:flex; align-items:center; justify-content:center; padding:0 3px; }
.rm-bell-btn{ border:none; background:none; padding:0; margin:0; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink); font-family:inherit; }
.rm-notif-panel{ position:absolute; top:calc(100% + 10px); right:0; width:340px; max-width:80vw; max-height:420px; overflow-y:auto; background:var(--paper-raised); border:1px solid var(--line); border-radius:16px; box-shadow:0 20px 40px -15px rgba(22,32,26,0.35); z-index:40; text-align:left; }
.rm-notif-header{ display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--line); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; color:var(--ink-soft); }
.rm-notif-row{ padding:11px 14px; border-bottom:1px solid var(--line); }
.rm-notif-row:last-child{ border-bottom:none; }
.rm-notif-title{ font-weight:800; font-size:12.5px; margin-top:5px; }
.rm-notif-detail{ font-size:11.5px; color:var(--ink-soft); font-weight:600; margin-top:2px; line-height:1.4; }

.rm-card{ background:var(--paper-raised); border:1px solid var(--line); border-radius:18px; padding:14px; margin-bottom:14px; box-shadow:0 10px 24px -18px rgba(22,32,26,0.3); }
.rm-card.muted{ opacity:0.6; }
.rm-section-label{ font-size:12px; font-weight:800; letter-spacing:.03em; text-transform:uppercase; color:var(--ink-soft); margin:4px 2px 8px; }

.rm-tag{ display:inline-flex; align-items:center; gap:6px; padding:5px 10px 5px 8px; border-radius:999px; font-size:11px; font-weight:800; white-space:nowrap; }
.rm-tag-dot{ width:6px; height:6px; border-radius:50%; flex:0 0 auto; }
.rm-tag.green{ background:var(--green-pale); color:#1F5C39; } .rm-tag.green .rm-tag-dot{ background:var(--green); }
.rm-tag.amber{ background:var(--amber-pale); color:#8A5417; } .rm-tag.amber .rm-tag-dot{ background:var(--amber); }
.rm-tag.red{ background:var(--red-pale); color:#8C2A20; } .rm-tag.red .rm-tag-dot{ background:var(--red); }
.rm-tag.blue{ background:var(--blue-pale); color:#28546E; } .rm-tag.blue .rm-tag-dot{ background:var(--blue); }
.rm-tag.neutral{ background:#ECEAE0; color:#5B665D; } .rm-tag.neutral .rm-tag-dot{ background:#9AA192; }
.rm-tag.plum{ background:var(--plum-pale); color:#5B3F61; } .rm-tag.plum .rm-tag-dot{ background:var(--plum); }

.rm-loyalty-card{ display:flex; align-items:center; justify-content:space-between; background:var(--green-deep); color:#fff; border-radius:18px; padding:16px 18px; margin-bottom:14px; }
.rm-loyalty-label{ font-size:11.5px; font-weight:700; opacity:0.7; text-transform:uppercase; letter-spacing:.03em; }
.rm-loyalty-num{ font-size:26px; margin-top:2px; }
.rm-scan-cta{ width:100%; display:flex; align-items:center; gap:12px; background:var(--green); color:#fff; border:none; border-radius:18px; padding:16px; margin-bottom:18px; cursor:pointer; font-family:inherit; }
.rm-scan-cta > div{ flex:1; }
.rm-scan-title{ font-weight:800; font-size:14.5px; text-align:left; }
.rm-scan-sub{ font-size:11.5px; opacity:0.85; text-align:left; font-weight:600; }
.rm-offer-row{ display:flex; gap:10px; margin-bottom:6px; }
.rm-offer-card{ flex:1; border-radius:16px; padding:13px; display:flex; flex-direction:column; gap:6px; }
.rm-offer-card.wide{ flex-direction:row; align-items:center; gap:12px; margin-bottom:10px; }
.rm-offer-card.green{ background:var(--green-pale); color:#1F5C39; }
.rm-offer-card.blue{ background:var(--blue-pale); color:#28546E; }
.rm-offer-card.amber{ background:var(--amber-pale); color:#8A5417; }
.rm-offer-title{ font-weight:800; font-size:12.5px; }
.rm-offer-sub{ font-size:11px; font-weight:600; opacity:0.8; }
.rm-fbt-row{ display:flex; flex-wrap:wrap; gap:8px; }
.rm-fbt-chip{ display:flex; align-items:center; gap:5px; background:var(--paper-raised); border:1px solid var(--line); padding:7px 11px; border-radius:999px; font-size:12px; font-weight:700; }
.rm-check-row{ display:flex; align-items:center; gap:10px; padding:9px 2px; font-size:14px; font-weight:600; border-bottom:1px solid var(--line); }
.rm-check-row:last-child{ border-bottom:none; }

.rm-quick-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:18px; }
.rm-qtile{ position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:20px; border:none; border-radius:16px; padding:14px; font-weight:800; font-size:12.5px; cursor:pointer; font-family:inherit; text-align:left; }
.rm-qtile.green{ background:var(--green-pale); color:#1F5C39; }
.rm-qtile.red{ background:var(--red-pale); color:#8C2A20; }
.rm-qtile.blue{ background:var(--blue-pale); color:#28546E; }
.rm-qtile.amber{ background:var(--amber-pale); color:#8A5417; }
.rm-qtile.plum{ background:var(--plum-pale); color:#5B3F61; }
.rm-qtile-count{ position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.16); padding:2px 7px; border-radius:8px; font-size:10.5px; }

.rm-task-row{ padding:8px 2px; border-bottom:1px solid var(--line); }
.rm-task-row:last-child{ border-bottom:none; }
.rm-task-title{ font-weight:700; font-size:13.5px; margin-top:5px; }
.rm-task-check{ display:flex; align-items:center; gap:11px; padding:10px 2px; border-bottom:1px solid var(--line); }
.rm-task-check:last-child{ border-bottom:none; }
.rm-task-check > div{ flex:1; }
.rm-task-detail{ font-size:11.5px; color:var(--ink-soft); font-weight:600; margin-top:2px; }
.strike{ text-decoration:line-through; color:var(--ink-soft); font-weight:600; font-size:13.5px; flex:1; }
.rm-empty-mini{ text-align:center; color:var(--ink-soft); font-size:13px; font-weight:600; padding:10px 0; }
.rm-loading{ display:flex; align-items:center; gap:8px; color:var(--ink-soft); font-size:13px; font-weight:600; padding:20px 2px; }
.rm-loading svg{ animation:rm-spin 0.9s linear infinite; }
@keyframes rm-spin{ to{ transform:rotate(360deg); } }

/* ── special-effects primitives (SkinSense-style hero language + Magic UI-style motion) ── */
@keyframes rm-shimmer-sweep{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }
.rm-btn-shimmer{
  position:relative; display:inline-flex; align-items:center; justify-content:center; gap:8px;
  background:linear-gradient(110deg, var(--green-deep) 0%, var(--green) 40%, #52C489 52%, var(--green) 64%, var(--green-deep) 100%);
  background-size:250% 100%; animation:rm-shimmer-sweep 3.4s linear infinite;
  color:#fff; border:none; border-radius:999px; padding:15px 26px; font-weight:800; font-size:14.5px;
  cursor:pointer; font-family:inherit; box-shadow:0 16px 30px -14px rgba(22,60,39,0.6);
  transition:transform .15s ease, box-shadow .2s ease;
}
.rm-btn-shimmer:hover{ transform:translateY(-1px); box-shadow:0 20px 36px -14px rgba(22,60,39,0.68); }
.rm-btn-shimmer:active{ transform:translateY(0) scale(.98); }

@keyframes rm-beam-spin{ to{ transform:rotate(360deg); } }
.rm-border-beam{ position:relative; isolation:isolate; }
.rm-border-beam::before{
  content:""; position:absolute; inset:-1.5px; border-radius:inherit; padding:1.5px; z-index:-1;
  background:conic-gradient(from 0deg, transparent 0%, var(--green) 14%, #8CF0BC 22%, transparent 36%);
  -webkit-mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor; mask-composite:exclude;
  animation:rm-beam-spin 4.5s linear infinite; pointer-events:none;
}

.rm-eyebrow-pill{ display:inline-flex; align-items:center; gap:8px; background:var(--green-pale); border:1px solid var(--line); border-radius:999px; padding:7px 15px; font-size:12.5px; font-weight:700; color:#1F5C39; }
.rm-eyebrow-pill .dot{ width:7px; height:7px; border-radius:50%; background:var(--green); flex:0 0 auto; }

.rm-glow-panel{ position:relative; overflow:hidden; background:linear-gradient(160deg,var(--green-deep),#123B29); border-radius:28px; padding:48px 44px; }
.rm-glow-panel::before{ content:""; position:absolute; inset:0; background:radial-gradient(circle at 86% 8%, rgba(140,240,188,0.32), transparent 58%); pointer-events:none; }
.rm-glow-panel > *{ position:relative; }

.rm-stat-strip{ background:linear-gradient(135deg,var(--green-deep),#1c4a32); border-radius:24px; padding:34px 30px; display:flex; justify-content:space-around; flex-wrap:wrap; gap:24px; align-items:center; }
.rm-stat-strip .stat{ text-align:center; padding:0 12px; }
.rm-stat-strip .stat .v{ font-size:1.9rem; font-weight:800; color:#fff; letter-spacing:-0.02em; }
.rm-stat-strip .stat .l{ font-size:0.7rem; color:#9CCBB6; letter-spacing:0.1em; text-transform:uppercase; margin-top:5px; font-weight:700; }

@keyframes rm-marquee-scroll{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
.rm-marquee{ overflow:hidden; -webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent); mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent); }
.rm-marquee-track{ display:flex; gap:14px; width:max-content; animation:rm-marquee-scroll 24s linear infinite; }
.rm-marquee:hover .rm-marquee-track{ animation-play-state:paused; }
.rm-marquee-chip{ flex:0 0 auto; display:flex; align-items:center; gap:8px; background:var(--paper-raised); border:1px solid var(--line); border-radius:999px; padding:9px 16px; font-size:12.5px; font-weight:700; color:var(--ink-soft); white-space:nowrap; }

.rm-hero-floatcard{ position:absolute; background:#fff; border-radius:16px; padding:14px 18px; box-shadow:0 18px 40px -14px rgba(22,32,26,0.4); }

.rm-faq-item{ background:var(--paper-raised); border:1px solid var(--line); border-radius:14px; overflow:hidden; margin-bottom:10px; }
.rm-faq-item summary{ cursor:pointer; list-style:none; padding:16px 20px; font-size:14px; font-weight:700; color:var(--ink); display:flex; align-items:center; justify-content:space-between; gap:14px; }
.rm-faq-item summary::-webkit-details-marker{ display:none; }
.rm-faq-item summary .plus{ color:var(--green); font-size:1.2rem; font-weight:400; transition:transform .18s ease; flex-shrink:0; }
.rm-faq-item[open] summary .plus{ transform:rotate(45deg); }
.rm-faq-item .body{ padding:0 20px 18px; font-size:13px; line-height:1.7; color:var(--ink-soft); }

.rm-ticker{ font-variant-numeric:tabular-nums; }

/* ── pricing ── */
.rm-pricing-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; align-items:stretch; }
.rm-pricing-card{ position:relative; background:var(--paper-raised); border:1px solid var(--line); border-radius:20px; padding:26px 24px; display:flex; flex-direction:column; }
.rm-pricing-card.featured{ border-color:var(--green); box-shadow:0 24px 48px -26px rgba(22,60,39,0.45); }
.rm-pricing-badge{ position:absolute; top:-11px; left:24px; background:var(--green); color:#fff; font-size:10.5px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; padding:5px 12px; border-radius:999px; }
.rm-pricing-name{ font-size:13px; font-weight:800; color:var(--ink-soft); letter-spacing:0.05em; text-transform:uppercase; margin-bottom:12px; }
.rm-pricing-price{ display:flex; align-items:baseline; gap:6px; font-size:34px; font-weight:800; color:var(--ink); letter-spacing:-0.03em; margin-bottom:12px; flex-wrap:wrap; }
.rm-pricing-price .cur{ font-size:15px; font-weight:700; color:var(--ink-soft); }
.rm-pricing-price .per{ font-size:12.5px; font-weight:700; color:var(--ink-soft); letter-spacing:0; }
.rm-pricing-price .custom{ font-size:30px; }
.rm-pricing-blurb{ font-size:13px; color:var(--ink-soft); line-height:1.6; margin:0 0 18px; font-weight:500; }
.rm-pricing-feats{ display:flex; flex-direction:column; gap:9px; margin-bottom:22px; flex:1; }
.rm-pricing-feat{ display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--ink); font-weight:600; line-height:1.45; }
.rm-pricing-feat svg{ color:var(--green); flex:0 0 auto; margin-top:2px; }
.rm-pricing-note{ text-align:center; font-size:12.5px; color:var(--ink-soft); font-weight:600; margin:22px 0 0; }

/* responsive for the new landing blocks — must come after their base rules above */
@media (max-width:900px){
  .rm-pricing-grid{ grid-template-columns:1fr; gap:22px; }
  .rm-pricing-card.featured{ order:-1; }
  .rm-glow-panel{ padding:32px 22px; border-radius:22px; }
  .rm-stat-strip{ padding:26px 18px; gap:18px; }
  .rm-stat-strip .stat{ flex:1 0 40%; padding:0 4px; }
  .rm-stat-strip .stat .v{ font-size:1.55rem; }
}
@media (max-width:600px){
  /* the nav's two CTAs crowd the wordmark at phone widths — the hero
     carries both actions a few hundred px below, so drop the secondary one */
  .rm-landing-nav-cta .rm-btn-ghost{ display:none; }
  .rm-landing-nav-cta .rm-btn-primary{ padding:9px 14px; font-size:12.5px; white-space:nowrap; }
  .rm-landing-nav-name{ font-size:15px; }
  .rm-hero-floatcard{ display:none; }
  .rm-stat-strip .stat .l{ font-size:0.62rem; letter-spacing:0.06em; }
  .rm-pricing-price{ font-size:29px; }
  .rm-pricing-card{ padding:24px 20px; }
  .rm-marquee-chip{ font-size:11.5px; padding:8px 13px; }
  .rm-eyebrow-pill{ font-size:11.5px; padding:6px 13px; }
  .rm-btn-shimmer{ padding:14px 22px; font-size:14px; }
}
.rm-error-banner{ display:flex; align-items:center; gap:8px; background:var(--red-pale); color:#8C2A20; border-radius:12px; padding:11px 13px; font-size:12.5px; font-weight:700; margin-bottom:14px; }
.rm-error-banner svg{ flex:0 0 auto; }
.rm-mini-note{ display:flex; align-items:center; gap:7px; font-size:11.5px; color:var(--ink-soft); font-weight:600; background:var(--paper-raised); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }

.rm-legend-row{ display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
.rm-legend-chip{ font-size:10.5px; font-weight:600; background:var(--paper-raised); border:1px solid var(--line); border-radius:999px; padding:6px 10px; color:var(--ink-soft); }
.rm-legend-chip b{ color:var(--ink); font-weight:800; }
.rm-review-note{ display:flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600; color:#1F5C39; background:var(--green-pale); border-radius:12px; padding:9px 12px; margin-bottom:14px; }
.rm-cam-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:9px; margin-bottom:18px; }
.rm-cam-tile{ position:relative; height:88px; border-radius:14px; overflow:hidden; padding:9px; background:linear-gradient(135deg,#17251C 0%,#0F1712 100%); display:flex; flex-direction:column; justify-content:flex-end; }
.rm-cam-tile::before{ content:''; position:absolute; inset:0; z-index:1; background:repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 7px); }
.rm-cam-tile::after{ content:''; position:absolute; top:8px; right:8px; width:8px; height:8px; border-radius:50%; z-index:3; }
.rm-cam-tile.green::after{ background:var(--green); box-shadow:0 0 8px var(--green); }
.rm-cam-tile.amber::after{ background:var(--amber); box-shadow:0 0 8px var(--amber); }
.rm-cam-tile.red::after{ background:var(--red); box-shadow:0 0 8px var(--red); }
.rm-cam-live{ position:relative; z-index:2; display:flex; align-items:center; gap:4px; color:#fff; font-size:8.5px; font-weight:800; letter-spacing:.04em; opacity:0.85; }
.rm-cam-live .dot{ width:5px; height:5px; border-radius:50%; background:#E14B3B; }
.rm-cam-name{ position:relative; z-index:2; color:#fff; font-size:11.5px; font-weight:800; margin-top:26px; }
.rm-cam-fill{ position:relative; z-index:2; color:rgba(255,255,255,0.65); font-size:10px; font-weight:700; margin-top:1px; }
.rm-alert-card{ background:var(--paper-raised); border:1px solid var(--line); border-radius:16px; padding:13px; margin-bottom:10px; }
.rm-alert-top{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.rm-alert-conf{ font-size:11px; font-weight:800; color:var(--ink-soft); }
.rm-alert-msg{ font-size:13.5px; font-weight:700; line-height:1.35; margin-bottom:6px; }
.rm-alert-meta{ font-size:11px; color:var(--ink-soft); font-weight:600; display:flex; align-items:center; gap:4px; margin-bottom:10px; }
.rm-alert-model{ color:var(--ink); font-weight:800; }
.rm-alert-bottom{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.rm-alert-assigned{ font-size:11px; font-weight:700; color:var(--ink-soft); }
.rm-mini-btn{ border:1.5px solid var(--line); background:transparent; border-radius:10px; padding:7px 12px; font-size:11px; font-weight:800; cursor:pointer; color:var(--ink); white-space:nowrap; font-family:inherit; }

.rm-cat-row{ display:flex; gap:7px; overflow-x:auto; padding-bottom:4px; margin-bottom:12px; }
.rm-cat-chip{ flex:0 0 auto; display:flex; align-items:center; gap:6px; border:1.5px solid var(--line); background:var(--paper-raised); border-radius:999px; padding:8px 13px; font-size:12px; font-weight:700; cursor:pointer; color:var(--ink-soft); font-family:inherit; }
.rm-cat-chip.active{ border-color:transparent; }
.rm-cat-chip.green.active{ background:var(--green-pale); color:#1F5C39; }
.rm-cat-chip.blue.active{ background:var(--blue-pale); color:#28546E; }
.rm-cat-chip.amber.active{ background:var(--amber-pale); color:#8A5417; }
.rm-cat-chip.red.active{ background:var(--red-pale); color:#8C2A20; }
.rm-model-tabs{ display:flex; background:var(--paper-raised); border:1px solid var(--line); border-radius:13px; padding:4px; gap:4px; margin-bottom:10px; }
.rm-model-tab{ flex:1; border:none; background:transparent; padding:8px 4px; border-radius:9px; font-size:12px; font-weight:800; color:var(--ink-soft); cursor:pointer; font-family:inherit; }
.rm-model-tab.active{ background:var(--ink); color:#fff; }
.rm-model-desc{ font-size:12px; color:var(--ink-soft); font-weight:600; line-height:1.5; margin-bottom:14px; min-height:32px; }
.chart-card{ padding:14px 8px 6px; }
.rm-chart-legend{ display:flex; gap:14px; justify-content:center; padding:8px 0 2px; font-size:10.5px; font-weight:700; color:var(--ink-soft); }
.rm-chart-legend .dot{ display:inline-block; width:7px; height:7px; border-radius:2px; margin-right:5px; }
.rm-chart-legend .dot.ink{ background:var(--ink); }
.rm-chart-legend .dot.green{ background:var(--green); }
.rm-chart-legend .dot.blue{ background:var(--blue); }
.rm-reco-card{ display:flex; gap:10px; background:var(--green-deep); color:#fff; border-radius:16px; padding:14px; font-size:12.5px; font-weight:600; line-height:1.5; margin-bottom:12px; }
.rm-reco-card svg{ flex:0 0 auto; margin-top:1px; }
.rm-mlops-strip{ display:flex; align-items:center; gap:6px; font-size:10.5px; font-weight:700; color:var(--ink-soft); justify-content:center; padding-bottom:6px; }

.rm-mode-card{ background:var(--paper-raised); border:1px solid var(--line); border-radius:16px; padding:13px; margin-bottom:12px; }
.rm-mode-label{ font-size:11.5px; font-weight:800; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.03em; margin-bottom:8px; }
.rm-store-scroll{ display:flex; gap:7px; overflow-x:auto; margin-top:10px; }
.rm-store-chip{ flex:0 0 auto; border:1.5px solid var(--line); background:var(--paper); border-radius:999px; padding:7px 12px; font-size:11.5px; font-weight:700; cursor:pointer; color:var(--ink-soft); font-family:inherit; }
.rm-store-chip span{ opacity:0.6; margin-left:3px; }
.rm-store-chip.active{ background:var(--green); border-color:var(--green); color:#fff; }
.rm-add-form{ display:flex; flex-direction:column; }
.rm-resp-label{ font-size:11.5px; font-weight:800; color:var(--ink-soft); margin:4px 0 8px; text-transform:uppercase; letter-spacing:.03em; }
.rm-resp-grid{ display:flex; flex-wrap:wrap; gap:7px; margin-bottom:14px; }
.rm-resp-chip{ display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; border:1.5px solid var(--line); border-radius:999px; padding:6px 11px 6px 8px; cursor:pointer; color:var(--ink-soft); }
.rm-resp-chip.active{ border-color:var(--green); background:var(--green-pale); color:#1F5C39; }
.rm-team-row{ display:flex; align-items:center; gap:11px; padding:11px 2px; border-bottom:1px solid var(--line); }
.rm-team-row:last-child{ border-bottom:none; }
.rm-avatar{ width:38px; height:38px; border-radius:12px; background:var(--green-deep); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:15px; flex:0 0 auto; }
.rm-avatar.big{ width:54px; height:54px; border-radius:16px; font-size:20px; }
.rm-team-mid{ flex:1; min-width:0; }
.rm-team-name{ font-weight:800; font-size:13.5px; }
.rm-team-sub{ font-size:11px; color:var(--ink-soft); font-weight:600; margin-top:1px; }
.rm-team-resp{ font-size:10.5px; color:#8C9188; font-weight:700; margin-top:2px; }
.rm-x-btn{ border:none; background:var(--paper); width:26px; height:26px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink-soft); flex:0 0 auto; }

.rm-route-row{ display:flex; align-items:flex-start; gap:12px; padding:10px 2px; border-bottom:1px solid var(--line); }
.rm-route-row:last-child{ border-bottom:none; }
.rm-route-step{ width:24px; height:24px; border-radius:8px; background:var(--green-pale); color:#1F5C39; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.rm-route-loc{ font-weight:800; font-size:13px; display:flex; align-items:center; gap:4px; }
.rm-route-task{ font-size:11.5px; color:var(--ink-soft); font-weight:600; margin-top:2px; }

.rm-reco-row{ display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; margin-bottom:18px; }
.rm-reco-item{ flex:0 0 auto; width:128px; border-radius:16px; padding:12px; display:flex; flex-direction:column; gap:5px; }
.rm-reco-item.green{ background:var(--green-pale); color:#1F5C39; }
.rm-reco-item.blue{ background:var(--blue-pale); color:#28546E; }
.rm-reco-item.amber{ background:var(--amber-pale); color:#8A5417; }
.rm-reco-icon{ width:28px; height:28px; border-radius:9px; background:rgba(255,255,255,0.55); display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
.rm-reco-name{ font-weight:800; font-size:12px; line-height:1.25; }
.rm-reco-reason{ font-size:10px; font-weight:600; opacity:0.8; line-height:1.3; }
.rm-reco-price{ font-weight:800; font-size:12px; margin-top:2px; }

.rm-kpi-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:18px; }
.rm-kpi-card{ background:var(--paper-raised); border:1px solid var(--line); border-radius:16px; padding:13px; }
.rm-kpi-label{ font-size:10.5px; font-weight:700; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.02em; margin-bottom:6px; }
.rm-kpi-value{ font-size:19px; font-weight:800; }
.rm-kpi-delta{ font-size:11px; font-weight:700; margin-top:3px; }
.rm-kpi-delta.good{ color:#1F5C39; }
.rm-kpi-delta.bad{ color:#8C2A20; }
.rm-legend-list{ display:flex; flex-direction:column; gap:7px; }
.rm-legend-item{ font-size:11.5px; font-weight:700; color:var(--ink-soft); display:flex; align-items:center; gap:7px; }
.rm-legend-item b{ color:var(--ink); font-weight:800; }
.rm-legend-dot{ width:9px; height:9px; border-radius:3px; flex:0 0 auto; }
.rm-waste-row{ display:flex; align-items:center; gap:10px; padding:8px 0; }
.rm-waste-name{ font-size:12px; font-weight:700; width:88px; flex:0 0 auto; color:var(--ink-soft); }
.rm-waste-track{ flex:1; height:7px; background:var(--paper); border-radius:4px; overflow:hidden; }
.rm-waste-fill{ height:100%; background:var(--amber); border-radius:4px; }
.rm-waste-pct{ font-size:12px; font-weight:800; width:34px; text-align:right; flex:0 0 auto; }
.rm-store-row{ display:flex; align-items:center; justify-content:space-between; background:var(--paper-raised); border:1px solid var(--line); border-radius:14px; padding:12px 14px; margin-bottom:8px; }
.rm-store-row-name{ font-weight:800; font-size:13px; }
.rm-store-row-name span{ font-weight:600; color:var(--ink-soft); font-size:11px; }
.rm-store-row-sub{ font-size:11px; color:var(--ink-soft); font-weight:600; margin-top:2px; }
.rm-store-row-rev{ font-weight:800; font-size:14px; color:var(--green); }

.rm-chat-msg-wrap{ display:flex; margin-bottom:12px; }
.rm-chat-msg-wrap.user{ justify-content:flex-end; }
.rm-chat-msg-wrap.assistant{ flex-direction:column; align-items:flex-start; }
.rm-chat-bubble{ max-width:85%; border-radius:16px; padding:10px 13px; font-size:13px; font-weight:600; line-height:1.45; }
.rm-chat-bubble.user{ background:var(--green); color:#fff; border-bottom-right-radius:4px; }
.rm-chat-bubble.assistant{ background:var(--paper-raised); border:1px solid var(--line); color:var(--ink); border-bottom-left-radius:4px; }
.rm-chat-agent-tag{ margin-bottom:5px; }
.rm-chat-suggestions{ display:flex; flex-wrap:wrap; gap:7px; margin:6px 0 4px; }
.rm-chat-suggestion{ font-size:11.5px; font-weight:700; border:1.5px solid var(--line); background:var(--paper-raised); border-radius:999px; padding:8px 12px; cursor:pointer; color:var(--ink-soft); text-align:left; font-family:inherit; }
.rm-chat-input-row{ position:sticky; bottom:0; display:flex; gap:8px; background:var(--paper); padding:10px 0 4px; margin-top:8px; }
.rm-chat-input{ flex:1; background:var(--paper-raised); border:1.5px solid var(--line); border-radius:14px; padding:11px 14px; font-size:13.5px; font-weight:600; outline:none; min-width:0; }
.rm-chat-send{ width:42px; height:42px; border-radius:12px; background:var(--green); border:none; display:flex; align-items:center; justify-content:center; color:#fff; cursor:pointer; flex:0 0 auto; }

.rm-po-card{ background:var(--paper-raised); border:1px solid var(--line); border-radius:16px; padding:13px; margin-bottom:10px; }
.rm-po-card.muted-card{ opacity:0.62; }
.rm-po-top{ display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
.rm-po-id{ font-size:11px; font-weight:800; color:var(--ink-soft); letter-spacing:.02em; }
.rm-po-cost{ font-size:13.5px; font-weight:800; }
.rm-po-supplier{ font-size:14px; font-weight:800; margin-bottom:2px; }
.rm-po-items{ font-size:12px; color:var(--ink-soft); font-weight:600; margin-bottom:8px; }
.rm-po-meta{ display:flex; align-items:center; gap:4px; font-size:10.5px; color:#8C9188; font-weight:700; margin-bottom:10px; }
.rm-po-actions{ display:flex; gap:8px; }
.rm-mini-btn.approve{ background:var(--green); color:#fff; border-color:var(--green); flex:1; text-align:center; }
.rm-mini-btn.reject{ color:var(--red); border-color:var(--red-pale); flex:1; text-align:center; }
.rm-sup-top{ display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px; }
.rm-sup-name{ font-weight:800; font-size:14.5px; }
.rm-sup-cat{ font-size:11.5px; color:var(--ink-soft); font-weight:600; margin-top:1px; }
.rm-sup-score{ text-align:center; flex:0 0 auto; }
.rm-sup-score-num{ font-size:20px; font-weight:800; color:var(--green); line-height:1; }
.rm-sup-score-lab{ font-size:9px; color:var(--ink-soft); font-weight:700; text-transform:uppercase; letter-spacing:.03em; margin-top:2px; }
.rm-sup-bar-track{ height:6px; background:var(--paper); border-radius:4px; overflow:hidden; margin-bottom:10px; }
.rm-sup-bar-fill{ height:100%; background:var(--green); border-radius:4px; }
.rm-sup-tags{ display:flex; flex-wrap:wrap; gap:6px; }

.rm-profile-head{ display:flex; align-items:center; gap:14px; margin-bottom:20px; }
.rm-profile-name{ font-weight:800; font-size:17px; }
.rm-profile-sub{ font-size:12.5px; color:var(--ink-soft); font-weight:600; margin:2px 0 6px; }

.rm-overlay{ position:fixed; inset:0; background:rgba(15,20,15,0.5); display:flex; align-items:center; justify-content:center; padding:26px; z-index:50; }
.rm-overlay-card{ position:relative; width:100%; background:var(--paper-raised); border-radius:22px; padding:24px 20px 20px; text-align:center; }
.rm-overlay-close{ position:absolute; top:12px; right:12px; width:28px; height:28px; border-radius:9px; border:none; background:var(--paper); display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink-soft); }
.rm-scan-result-icon{ width:56px; height:56px; border-radius:16px; background:var(--green); display:flex; align-items:center; justify-content:center; margin:4px auto 12px; }
.rm-scan-result-title{ font-size:19px; font-weight:700; }
.rm-scan-result-price{ font-size:14px; font-weight:800; color:var(--green); margin:4px 0 12px; }
.rm-scan-result-price span{ color:var(--ink-soft); font-weight:600; font-size:12px; }
.rm-scan-tags{ display:flex; gap:7px; justify-content:center; margin-bottom:16px; flex-wrap:wrap; }
.rm-scan-nutri{ display:flex; justify-content:center; gap:22px; margin-bottom:16px; }
.n-val{ font-size:16px; font-weight:800; }
.n-lab{ font-size:10.5px; color:var(--ink-soft); font-weight:700; margin-top:1px; }
.rm-swap-card{ display:flex; align-items:flex-start; gap:9px; background:var(--green-pale); border-radius:14px; padding:12px; font-size:12px; font-weight:600; color:#1F5C39; text-align:left; line-height:1.45; margin-bottom:16px; }

.rm-pos-layout{ display:flex; flex-direction:column; gap:20px; align-items:flex-start; }
.rm-pos-main{ flex:1 1 auto; min-width:0; width:100%; }
.rm-pos-side{ flex:0 0 auto; width:100%; }
.rm-pos-results{ max-height:260px; overflow-y:auto; margin-bottom:4px; }
.rm-cart-row{ display:flex; align-items:center; gap:10px; padding:10px 2px; border-bottom:1px solid var(--line); }
.rm-cart-row:last-child{ border-bottom:none; }
.rm-cart-name{ font-weight:700; font-size:13.5px; }
.rm-cart-price{ font-size:11.5px; color:var(--ink-soft); font-weight:600; margin-top:1px; }
.rm-qty-stepper{ display:flex; align-items:center; gap:6px; flex:0 0 auto; }
.rm-qty-btn{ width:26px; height:26px; border-radius:8px; border:1.5px solid var(--line); background:var(--paper-raised); display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink); font-family:inherit; }
.rm-qty-num{ font-weight:800; font-size:13.5px; min-width:18px; text-align:center; }
.rm-cart-line-total{ font-weight:800; font-size:13.5px; min-width:64px; text-align:right; }
.rm-cart-remove{ border:none; background:transparent; color:var(--red); cursor:pointer; display:flex; padding:4px; flex:0 0 auto; }
.rm-pos-totals{ border-top:1.5px dashed var(--line); margin-top:6px; padding-top:12px; }
.rm-pos-total-row{ display:flex; justify-content:space-between; font-size:13px; font-weight:600; color:var(--ink-soft); margin-bottom:5px; }
.rm-pos-total-row.grand{ font-size:19px; font-weight:800; color:var(--ink); margin-top:6px; }
.rm-pay-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
.rm-pay-btn{ display:flex; flex-direction:column; align-items:center; gap:6px; background:var(--paper-raised); border:1.5px solid var(--line); border-radius:13px; padding:12px 8px; cursor:pointer; font-weight:700; font-size:12px; color:var(--ink); font-family:inherit; }
.rm-pay-btn.active{ background:var(--green); border-color:var(--green); color:#fff; }
.rm-customer-chip{ display:flex; align-items:center; gap:10px; background:var(--green-pale); border-radius:14px; padding:11px 13px; margin-bottom:12px; }
.rm-customer-chip-name{ font-weight:800; font-size:13.5px; color:#1F5C39; }
.rm-customer-chip-sub{ font-size:11px; color:#1F5C39; font-weight:600; opacity:0.85; }
.rm-receipt-card{ background:var(--paper-raised); border:1.5px solid var(--green); border-radius:16px; padding:16px; margin-bottom:14px; }

@media (min-width:760px){
  .rm-quick-grid{ grid-template-columns:repeat(4,1fr); }
  .rm-kpi-grid{ grid-template-columns:repeat(4,1fr); }
  .rm-cam-grid{ grid-template-columns:repeat(3,1fr); }
  .rm-offer-row{ gap:14px; }
}
@media (min-width:1000px){
  .rm-cam-grid{ grid-template-columns:repeat(4,1fr); }
}
@media (min-width:900px){
  .rm-pos-layout{ flex-direction:row; }
  .rm-pos-main{ flex:1.3; }
  .rm-pos-side{ flex:1; position:sticky; top:0; }
}
`;

/* ----------------------------- static UI config ----------------------------- */
/* Everything data-bearing (team, alerts, tasks, suppliers, orders, forecasts,
   analytics) now comes from the FastAPI backend — see fetch* calls below.
   What's left here is copy/labels the backend has no reason to own. */

const DEPTS = ["Store Management","Inventory & Shelf Ops","Procurement & Suppliers","Sales & Customer Experience","Warehouse & Logistics","Food Safety & Quality","Regional Operations","Finance & Analytics"];

const RESPONSIBILITIES = ["Inventory Monitoring","Shelf & CCTV Alerts","Purchase Approvals","Supplier Management","Demand Forecasting","Store Analytics","Customer & Offers","Team & Access"];

const MODELS = [
  { id: "prophet", label: "Prophet", desc: "Captures weekly & holiday seasonality — strong for produce and bakery cycles." },
  { id: "xgboost", label: "XGBoost", desc: "Best short-horizon accuracy using promo, price and weather features." },
  { id: "lstm", label: "LSTM", desc: "Learns sequential purchase patterns for gradually shifting trends." },
  { id: "tft", label: "TFT", desc: "Multi-horizon, interpretable attention — best overall production accuracy." },
];

// id must match the category string stored in the backend (products/sales_records.category)
const CATEGORIES = [
  { id: "Produce", Icon: Apple, tone: "green" },
  { id: "Dairy & Chilled", Icon: Milk, tone: "blue" },
  { id: "Frozen", Icon: Snowflake, tone: "blue" },
  { id: "Bakery", Icon: Wheat, tone: "amber" },
  { id: "Meat & Seafood", Icon: Beef, tone: "red" },
];

const CUSTOMER_TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "list", label: "List", Icon: ClipboardList },
  { id: "offers", label: "Offers", Icon: Gift },
  { id: "profile", label: "Profile", Icon: User },
];
const ASSOCIATE_TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "cashier", label: "Cashier", Icon: ShoppingCart },
  { id: "tasks", label: "Tasks", Icon: ClipboardList },
  { id: "cctv", label: "CCTV", Icon: Video },
  { id: "forecast", label: "Forecast", Icon: TrendingUp },
  { id: "profile", label: "Profile", Icon: User },
];
const ADMIN_TABS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "cashier", label: "Cashier", Icon: ShoppingCart },
  { id: "cctv", label: "CCTV", Icon: Video },
  { id: "forecast", label: "Forecast", Icon: TrendingUp },
  { id: "team", label: "Team", Icon: Users },
  { id: "profile", label: "Profile", Icon: User },
];

function categoryIcon(category) {
  return CATEGORIES.find((c) => c.id === category)?.Icon || Tag;
}

/* ----------------------------- shared ui bits ----------------------------- */

function ShelfTag({ tone = "neutral", children }) {
  return <span className={"rm-tag " + tone}><span className="rm-tag-dot" />{children}</span>;
}

function NumberTicker({ value, duration = 1100, decimals = 0, prefix = "", suffix = "" }) {
  const [display, setDisplay] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setDisplay(value);
      return;
    }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setStarted(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [value]);

  useEffect(() => {
    if (!started) return;
    let raf;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, value, duration]);

  return <span ref={ref} className="rm-ticker">{prefix}{display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

const CATEGORY_COLORS = { "Produce": "#2E7D4F", "Meat & Seafood": "#B93A2C", "Dairy & Chilled": "#376C93", "Frozen": "#7D5A85", "Bakery": "#C9791E" };

function taskTone(source) {
  if (source === "Loss prevention") return "red";
  if (source === "Procurement") return "blue";
  if (source === "Supplier schedule") return "green";
  return "amber"; // Shelf monitoring, Quality inspection, and anything else
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso) - Date.now()) / 86400000);
}

function loyaltyTier(points) {
  if (points >= 1000) return "Gold tier";
  if (points >= 400) return "Silver tier";
  return "Bronze tier";
}

function Loading({ label = "Loading…" }) {
  return <div className="rm-loading"><Loader2 size={16} />{label}</div>;
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="rm-error-banner" role="alert"><AlertTriangle size={15} />{message}</div>;
}

function NotificationBell({ token, storeId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const wrapRef = useRef(null);

  const load = useCallback(() => {
    if (!storeId) return;
    apiFetch(`/notifications?store_id=${storeId}`, { token }).then(setItems).catch(() => {});
  }, [storeId, token]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="rm-bell-wrap" ref={wrapRef}>
      <button className="rm-bell-btn" onClick={() => { setOpen((o) => !o); if (!open) load(); }}>
        <Bell size={18} />
        {items.length > 0 && <span className="rm-bell-dot">{items.length}</span>}
      </button>
      {open && (
        <div className="rm-notif-panel">
          <div className="rm-notif-header">
            Notifications
            <button className="rm-x-btn" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
          {items.length === 0 && <div className="rm-empty-mini">All clear — nothing needs attention.</div>}
          {items.map((n) => (
            <div key={n.id} className="rm-notif-row">
              <ShelfTag tone={n.severity}>{n.kind === "restock" ? "Restock" : n.kind === "order" ? "Payment" : n.kind}</ShelfTag>
              <div className="rm-notif-title">{n.title}</div>
              <div className="rm-notif-detail">{n.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar({ title, subtitle, icon, display }) {
  return (
    <div className="rm-topbar">
      <div>
        <div className={"rm-topbar-title" + (display ? " rm-display" : "")}>{title}</div>
        {subtitle && <div className="rm-topbar-sub">{subtitle}</div>}
      </div>
      {icon && <div className="rm-topbar-icon">{icon}</div>}
    </div>
  );
}

function QuickTile({ Icon, label, count, tone, onClick }) {
  return (
    <button className={"rm-qtile " + tone} onClick={onClick}>
      <Icon size={20} />
      <span>{label}</span>
      {!!count && <span className="rm-qtile-count">{count}</span>}
    </button>
  );
}

function SidebarNav({ items, active, onChange }) {
  return (
    <nav className="rm-sidebar-nav">
      {items.map((it) => (
        <button key={it.id} className={"rm-tab" + (active === it.id ? " active" : "")} onClick={() => onChange(it.id)}>
          <it.Icon size={18} strokeWidth={active === it.id ? 2.4 : 2} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ----------------------------- front page (marketing, before login) ----------------------------- */

const LANDING_IMG = {
  produce: "https://images.unsplash.com/photo-1553799262-a37c45961038?w=800&q=75&auto=format&fit=crop",
  family: "https://images.unsplash.com/photo-1619593593532-2b57ed251df2?w=800&q=75&auto=format&fit=crop",
  dress: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=75&auto=format&fit=crop",
};

const LANDING_NAV_LINKS = [["#solution", "Platform"], ["#features", "Features"], ["#built-for", "Built For"], ["#live-ops", "Live Ops"], ["#pricing", "Pricing"], ["#faq", "FAQ"]];

const STORE_MARQUEE = ["Downtown Central #104", "Riverside Mall #212", "North Hills #319", "Airport Plaza #087"];

// Set VITE_SALES_EMAIL in frontend/.env to turn the Enterprise button into a real "Talk to us" mailto link.
const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL;

const PRICING_TIERS = [
  {
    name: "Single Store", price: 249, cta: "Try the demo",
    blurb: "One location, the full platform. Right for an independent grocer or a single boutique.",
    features: ["Demand forecasting", "Cashier & POS", "Shelf & loss alerts", "Customer app", "Unlimited staff accounts"],
  },
  {
    name: "Multi-Store", price: 199, featured: true, cta: "Try the demo",
    blurb: "Two or more locations, with enterprise rollups across the whole estate.",
    features: ["Everything in Single Store", "Enterprise mode & rollups", "Cross-store P&L", "Supplier scorecards", "CSV/Sheets bulk import", "Priority support"],
  },
  {
    name: "Enterprise", price: null, cta: SALES_EMAIL ? "Talk to us" : "Explore the demo", href: SALES_EMAIL ? `mailto:${SALES_EMAIL}?subject=RetailMind%20Enterprise` : undefined,
    blurb: "Large estates that need their own deployment, SSO and data residency.",
    features: ["Everything in Multi-Store", "Self-hosted or private cloud", "SSO & audit logging", "Custom model tuning", "Dedicated success manager"],
  },
];

const LANDING_FAQ = [
  ["Is this connected to a real backend?", "Yes — every screen calls a real FastAPI service backed by Postgres. There's no mock JSON anywhere in the app; if a screen has no data yet, it says so honestly instead of faking a number."],
  ["What happens when I check out or ring up a sale?", "A real order is created, loyalty points are earned or redeemed, and stock is decremented from real batches — the same FEFO (first-expired-first-out) order a physical store would pull from."],
  ["Does the forecast actually train a model?", "Yes. Prophet, XGBoost, an LSTM and an attention-based model each train against real sales history, and re-train whenever that data changes — nothing is a canned chart."],
  ["Is the Profit & Loss screen real?", "Revenue, cost of goods sold, gross margin, shrinkage and loyalty liability are all computed from real orders and each product's landed cost. It stops at gross margin since rent and payroll aren't modeled — that's the honest boundary of what this data supports."],
  ["Can I try every role?", "Yes — sign in as Marcus (Admin), Priya (Manager), Diego (Staff) or Layla (Customer) from the demo accounts on the sign-in screen. Each role sees a genuinely different set of screens and permissions."],
];

function hideBrokenImage(e) { e.currentTarget.style.visibility = "hidden"; }

function ScreenLanding({ onEnter }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="rm-landing">
      <nav className="rm-landing-nav" aria-label="Primary">
        <div className="rm-landing-nav-inner">
          <div className="rm-landing-nav-brand">
            <div className="mark"><Leaf size={18} color="#fff" /></div>
            <div className="rm-display rm-landing-nav-name">RetailMind</div>
          </div>
          <div className="rm-landing-nav-links">
            {LANDING_NAV_LINKS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
          </div>
          <div className="rm-landing-nav-cta">
            <button className="rm-btn-ghost" onClick={onEnter}>Sign In</button>
            <button className="rm-btn-primary" onClick={onEnter}>Get Started<ChevronRight size={15} /></button>
            <button type="button" className="rm-landing-menu-btn" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="rm-landing-mobile-menu" onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div id="rm-landing-mobile-menu" className="rm-landing-mobile-menu">
            {LANDING_NAV_LINKS.map(([href, label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
          </div>
        )}
      </nav>

      <main>
      <section className="rm-landing-hero">
        <div>
          <div className="rm-eyebrow-pill"><span className="dot" />Free to try · Real backend · Live data</div>
          <h1 className="rm-display rm-landing-h1">Every aisle, every shelf,<br /><span style={{ color: "var(--green)" }}>predicted.</span></h1>
          <p className="rm-landing-sub">From the fresh produce stand to the dress rack, RetailMind forecasts demand, flags shrink, routes procurement, and keeps every store team a step ahead — for the people who shop, and the people who run the floor.</p>

          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", margin: "4px 0 26px" }}>
            <div><div className="rm-display" style={{ fontSize: 22, fontWeight: 800 }}><NumberTicker value={4} /></div><div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>Live stores</div></div>
            <div><div className="rm-display" style={{ fontSize: 22, fontWeight: 800 }}><NumberTicker value={4} /></div><div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>Forecast models</div></div>
            <div><div className="rm-display" style={{ fontSize: 22, fontWeight: 800 }}><NumberTicker value={6} /></div><div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>Payment methods</div></div>
          </div>

          <div className="rm-landing-cta-row">
            <div className="rm-border-beam" style={{ borderRadius: 999 }}>
              <button className="rm-btn-shimmer" onClick={onEnter}>Get Started<ChevronRight size={16} /></button>
            </div>
            <button className="rm-btn-ghost" onClick={onEnter}>Sign In</button>
          </div>
          <div className="rm-landing-microcopy">Real forecasting models · Live inventory · One platform for shoppers and staff</div>
        </div>
        <div className="rm-hero-collage">
          <img className="rm-hero-photo p1" src={LANDING_IMG.produce} width="800" height="533" alt="Fresh produce market stand" onError={hideBrokenImage} />
          <img className="rm-hero-photo p2" src={LANDING_IMG.family} width="800" height="1200" alt="Happy family shopping together" onError={hideBrokenImage} />
          <img className="rm-hero-photo p3" src={LANDING_IMG.dress} width="800" height="533" alt="Dress rack in a boutique" onError={hideBrokenImage} />
          <div className="rm-border-beam rm-hero-floatcard" style={{ bottom: 26, right: -6, borderRadius: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-soft)", fontWeight: 800, marginBottom: 6 }}>Sample alert · Downtown Central</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Dairy restock flagged</div>
            <div style={{ width: 130, height: 5, background: "var(--paper)", borderRadius: 100, overflow: "hidden" }}>
              <div style={{ width: "82%", height: "100%", background: "var(--green)", borderRadius: 100 }} />
            </div>
          </div>
        </div>
      </section>

      <section className="rm-landing-section" id="solution">
        <div className="rm-landing-section-head">
          <div className="rm-eyebrow">Our Solution</div>
          <h2 className="rm-display rm-landing-h2">One system for forecasting, shelves, and people</h2>
          <p className="rm-landing-p">RetailMind connects demand forecasting, procurement, loss-prevention, and the customer app — so a stockout in produce or a slow rack of dresses gets caught before it costs a sale.</p>
        </div>
        <div className="rm-feature-grid" id="features">
          <div className="rm-feature-card">
            <div className="ic"><TrendingUp size={19} /></div>
            <h3>Demand Forecasting</h3>
            <p>Prophet &amp; XGBoost models trained on real sales history, down to the store and SKU.</p>
          </div>
          <div className="rm-feature-card">
            <div className="ic"><Truck size={19} /></div>
            <h3>Smart Procurement</h3>
            <p>Purchase orders that route to the right supplier before shelves run dry.</p>
          </div>
          <div className="rm-feature-card">
            <div className="ic"><Video size={19} /></div>
            <h3>Shelf &amp; Loss Alerts</h3>
            <p>Catch a spill, a gap, or a shrink risk while it's still cheap to fix.</p>
          </div>
          <div className="rm-feature-card">
            <div className="ic"><ShoppingCart size={19} /></div>
            <h3>Customer Experience</h3>
            <p>Scan, list, and checkout tools that keep shoppers — and their families — coming back.</p>
          </div>
        </div>
      </section>

      <section className="rm-landing-section" id="built-for">
        <div className="rm-landing-section-head">
          <div className="rm-eyebrow">Built For Every Aisle</div>
          <h2 className="rm-display rm-landing-h2">Fashion, fresh food, and the families who shop both</h2>
        </div>
        <div className="rm-photo-trio">
          <div className="rm-photo-card">
            <img src={LANDING_IMG.dress} width="800" height="533" loading="lazy" decoding="async" alt="Apparel rack of dresses" onError={hideBrokenImage} />
            <div className="rm-photo-card-label"><div className="tag">Apparel</div><div className="rm-display ti">Fashion &amp; dresses</div></div>
          </div>
          <div className="rm-photo-card">
            <img src={LANDING_IMG.produce} width="800" height="533" loading="lazy" decoding="async" alt="Fresh produce market" onError={hideBrokenImage} />
            <div className="rm-photo-card-label"><div className="tag">Grocery</div><div className="rm-display ti">Fresh produce</div></div>
          </div>
          <div className="rm-photo-card">
            <img src={LANDING_IMG.family} width="800" height="1200" loading="lazy" decoding="async" alt="Happy family shopping together" onError={hideBrokenImage} />
            <div className="rm-photo-card-label"><div className="tag">Everyday</div><div className="rm-display ti">Happy families</div></div>
          </div>
        </div>
      </section>

      <section className="rm-landing-section" id="live-ops">
        <div className="rm-glow-panel">
          <div className="rm-eyebrow-pill" style={{ background: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.18)", color: "#8CF0BC" }}>
            <span className="dot" style={{ background: "#8CF0BC" }} />Live operations
          </div>
          <h2 className="rm-display" style={{ fontSize: "1.9rem", fontWeight: 800, color: "#fff", margin: "14px 0 12px", letterSpacing: "-0.025em" }}>Nothing here is a mock screen</h2>
          <p style={{ fontSize: 15, color: "#B9DCCB", lineHeight: 1.7, margin: "0 0 30px", maxWidth: 620 }}>
            Every number on every screen is computed live from a real FastAPI backend and Postgres database — real forecasting models, real stock levels, real orders. Switch stores and watch it actually change.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 18 }}>
            <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", marginBottom: 7 }}>Forecasting that trains live</div>
              <p style={{ fontSize: 13, color: "#B9DCCB", lineHeight: 1.65, margin: 0 }}>Prophet, XGBoost, LSTM and an attention-based model, retrained against real sales history whenever it changes.</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", marginBottom: 7 }}>Stock that actually moves</div>
              <p style={{ fontSize: 13, color: "#B9DCCB", lineHeight: 1.65, margin: 0 }}>Every checkout — self-service or at the register — decrements real batches, FEFO-ordered, the way a real store's shelves deplete.</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "#fff", marginBottom: 7 }}>A real P&amp;L, not a demo number</div>
              <p style={{ fontSize: 13, color: "#B9DCCB", lineHeight: 1.65, margin: 0 }}>Revenue, cost of goods sold and margin computed from real orders and each product's landed cost.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rm-landing-section" style={{ paddingTop: 0 }}>
        <div className="rm-marquee">
          <div className="rm-marquee-track">
            {[...STORE_MARQUEE, ...STORE_MARQUEE].map((s, i) => (
              <span key={i} className="rm-marquee-chip"><Store size={13} />{s}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="rm-landing-section">
        <div className="rm-stat-strip">
          <div className="stat"><div className="v"><NumberTicker value={4} /></div><div className="l">Forecasting models</div></div>
          <div className="stat"><div className="v"><NumberTicker value={6} /></div><div className="l">Payment methods</div></div>
          <div className="stat"><div className="v"><NumberTicker value={4} /></div><div className="l">Stores connected</div></div>
          <div className="stat"><div className="v"><NumberTicker value={4} /></div><div className="l">Roles to try</div></div>
        </div>
      </section>

      <section className="rm-landing-section" id="pricing">
        <div className="rm-landing-section-head">
          <div className="rm-eyebrow-pill"><span className="dot" />Pricing</div>
          <h2 className="rm-display rm-landing-h2" style={{ marginTop: 14 }}>Priced per store, not per seat</h2>
          <p className="rm-landing-p">Your whole floor team gets access on every plan — managers, associates and the customer app. You only pay for the stores you run.</p>
        </div>
        <div className="rm-pricing-grid">
          {PRICING_TIERS.map((t) => (
            <div key={t.name} className={"rm-pricing-card" + (t.featured ? " featured" : "")}>
              {t.featured && <div className="rm-pricing-badge">Most popular</div>}
              <div className="rm-pricing-name">{t.name}</div>
              <div className="rm-pricing-price">
                {t.price === null ? <span className="custom">Custom</span> : <><span className="cur">AED</span> <NumberTicker value={t.price} /><span className="per">/store · mo</span></>}
              </div>
              <p className="rm-pricing-blurb">{t.blurb}</p>
              <div className="rm-pricing-feats">
                {t.features.map((f) => (
                  <div key={f} className="rm-pricing-feat"><Check size={14} />{f}</div>
                ))}
              </div>
              {t.href
                ? <a className="rm-btn-ghost rm-w100" href={t.href}>{t.cta}</a>
                : <button className={t.featured ? "rm-btn-shimmer rm-w100" : "rm-btn-ghost rm-w100"} onClick={onEnter}>{t.cta}</button>}
            </div>
          ))}
        </div>
        <p className="rm-pricing-note">Every plan includes the full forecasting suite, the cashier/POS, and the customer app — no feature gating, no per-seat maths.</p>
      </section>

      <section className="rm-landing-section" id="faq">
        <div className="rm-landing-section-head">
          <div className="rm-eyebrow-pill"><span className="dot" />FAQ</div>
          <h2 className="rm-display rm-landing-h2" style={{ marginTop: 14 }}>Questions people ask first</h2>
        </div>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {LANDING_FAQ.map(([q, a]) => (
            <details key={q} className="rm-faq-item">
              <summary><span>{q}</span><span className="plus">+</span></summary>
              <div className="body">{a}</div>
            </details>
          ))}
        </div>
      </section>

      <div className="rm-cta-band">
        <div>
          <h3 className="rm-display">Ready to see it running?</h3>
          <p>Sign in with a demo account — every screen is wired to real data.</p>
        </div>
        <div className="rm-border-beam" style={{ borderRadius: 999 }}>
          <button className="rm-btn-shimmer" onClick={onEnter}>Sign In<ChevronRight size={16} /></button>
        </div>
      </div>

      </main>

      <footer className="rm-landing-footer">
        <div className="rm-landing-footer-inner">
          <div className="rm-footer-brand">
            <div className="rm-landing-nav-brand">
              <div className="mark"><Leaf size={16} color="#fff" /></div>
              <div className="rm-display rm-landing-nav-name">RetailMind</div>
            </div>
            <p>Fresh operations, predicted. Forecasting, procurement, and the floor — one platform.</p>
          </div>
          <div className="rm-footer-cols">
            <div className="rm-footer-col">
              <div className="h">Product</div>
              <button type="button" className="rm-footer-link" onClick={onEnter}>Forecasting</button>
              <button type="button" className="rm-footer-link" onClick={onEnter}>Procurement</button>
              <button type="button" className="rm-footer-link" onClick={onEnter}>Customer App</button>
            </div>
            <div className="rm-footer-col">
              <div className="h">Company</div>
              <button type="button" className="rm-footer-link" onClick={onEnter}>About</button>
              <button type="button" className="rm-footer-link" onClick={onEnter}>Careers</button>
            </div>
            <div className="rm-footer-col">
              <div className="h">Account</div>
              <button type="button" className="rm-footer-link" onClick={onEnter}>Sign In</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------- login ----------------------------- */

const DEMO_LOGINS = [
  { email: "marcus@retailmind.demo", label: "Marcus · Admin" },
  { email: "priya@retailmind.demo", label: "Priya · Manager" },
  { email: "diego@retailmind.demo", label: "Diego · Staff" },
  { email: "layla@example.com", label: "Layla · Customer" },
];

function ScreenLogin({ onLogin, loading, error }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!loading) onLogin(email, pw);
  }

  return (
    <form className="rm-login" onSubmit={submit}>
      <div className="rm-login-top">
        <div className="rm-brandmark"><Leaf size={24} color="#fff" /></div>
        <div className="rm-display rm-login-title">RetailMind</div>
        <div className="rm-login-tag">Fresh operations, predicted.</div>
      </div>

      <ErrorBanner message={error} />

      <div className="rm-field">
        <Mail size={16} color="#8C9188" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} className="rm-input" type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Email address" aria-label="Email address" required />
      </div>
      <div className="rm-field">
        <Lock size={16} color="#8C9188" />
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" className="rm-input" name="password" autoComplete="current-password" placeholder="Password" aria-label="Password" required />
      </div>

      <button className="rm-btn-primary rm-w100" type="submit" disabled={loading}>
        {loading ? <Loader2 size={16} style={{ animation: "rm-spin 0.9s linear infinite" }} /> : null}
        {loading ? "Signing in…" : "Sign In"}
      </button>

      <div className="rm-divider"><span>demo accounts</span></div>
      <div className="rm-resp-grid" style={{ marginBottom: 4 }}>
        {DEMO_LOGINS.map((d) => (
          <button type="button" key={d.email} className="rm-resp-chip" onClick={() => { setEmail(d.email); setPw("demo1234"); }}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="rm-login-caption">Real login against the FastAPI backend — password for every demo account is <b>demo1234</b>. Your role and access level come from the account itself, not a picker.</div>
    </form>
  );
}

/* ----------------------------- customer screens ----------------------------- */

function ScanResultOverlay({ token, onClose, onAdded }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    apiFetch(`/customer/products?search=${encodeURIComponent(query.trim())}`, { token })
      .then((res) => { if (!cancelled) setResults(res); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [query, token]);

  async function addToList() {
    if (!selected) return;
    setAdding(true);
    setError("");
    try {
      await apiFetch("/customer/shopping-list", { method: "POST", token, body: { product_id: selected.id, quantity: 1 } });
      onAdded?.();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't add to list");
    } finally {
      setAdding(false);
    }
  }

  const Icon = selected ? categoryIcon(selected.category) : ScanLine;

  return (
    <div className="rm-overlay" onClick={onClose}>
      <div className="rm-overlay-card" onClick={(e) => e.stopPropagation()}>
        <button className="rm-overlay-close" onClick={onClose}><X size={18} /></button>

        {!selected && (
          <>
            <div className="rm-scan-result-icon"><ScanLine size={26} color="#fff" /></div>
            <div className="rm-display rm-scan-result-title">Find a product</div>
            <div className="rm-login-tag" style={{ marginBottom: 14 }}>No camera hardware here — search by name instead of a live scan.</div>
            <input
              className="rm-input full" placeholder="Search products…" autoFocus
              value={query} onChange={(e) => setQuery(e.target.value)}
            />
            <div style={{ textAlign: "left", maxHeight: 220, overflowY: "auto" }}>
              {results.map((p) => (
                <div key={p.id} className="rm-check-row" style={{ cursor: "pointer" }} onClick={() => setSelected(p)}>
                  <span>{p.name}</span>
                  <span style={{ marginLeft: "auto", color: "var(--ink-soft)", fontWeight: 700, fontSize: 12.5 }}>AED {p.price.toFixed(2)}</span>
                </div>
              ))}
              {query.trim().length >= 2 && results.length === 0 && <div className="rm-empty-mini">No matches.</div>}
            </div>
          </>
        )}

        {selected && (
          <>
            <div className="rm-scan-result-icon"><Icon size={26} color="#fff" /></div>
            <div className="rm-display rm-scan-result-title">{selected.name}</div>
            <div className="rm-scan-result-price">AED {selected.price.toFixed(2)} <span>/ {selected.unit}</span></div>
            <div className="rm-scan-tags">
              {selected.dietary_tags.map((t) => <ShelfTag key={t} tone="green">{t}</ShelfTag>)}
              {selected.allergens.map((a) => <ShelfTag key={a} tone="amber">Contains {a}</ShelfTag>)}
            </div>
            {Object.keys(selected.nutrition).length > 0 && (
              <div className="rm-scan-nutri">
                {selected.nutrition.kcal != null && <div><div className="n-val">{selected.nutrition.kcal}</div><div className="n-lab">kcal</div></div>}
                {selected.nutrition.carbs_g != null && <div><div className="n-val">{selected.nutrition.carbs_g}g</div><div className="n-lab">carbs</div></div>}
                {selected.nutrition.protein_g != null && <div><div className="n-val">{selected.nutrition.protein_g}g</div><div className="n-lab">protein</div></div>}
              </div>
            )}
            <ErrorBanner message={error} />
            <button className="rm-btn-ghost rm-w100" style={{ marginBottom: 8 }} onClick={() => setSelected(null)}>Back to search</button>
            <button className="rm-btn-primary rm-w100" onClick={addToList} disabled={adding}>{adding ? "Adding…" : "Add to list"}</button>
          </>
        )}
      </div>
    </div>
  );
}

function ScreenCustomerHome({ name, points, onScan, onNav, token }) {
  const [offers, setOffers] = useState([]);
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/customer/offers", { token }),
      apiFetch("/customer/recommendations", { token }),
    ])
      .then(([o, r]) => { if (!cancelled) { setOffers(o); setRecs(r); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="rm-screen">
      <TopBar title={"Hi, " + name} subtitle="Fresh operations, predicted." icon={<Bell size={18} />} display />
      <div className="rm-loyalty-card">
        <div>
          <div className="rm-loyalty-label">Loyalty points</div>
          <div className="rm-display rm-loyalty-num"><NumberTicker value={points} /></div>
        </div>
        <ShelfTag tone="green">{loyaltyTier(points)}</ShelfTag>
      </div>

      <button className="rm-scan-cta" onClick={onScan}>
        <ScanLine size={22} />
        <div>
          <div className="rm-scan-title">Find a product</div>
          <div className="rm-scan-sub">Nutrition, allergens & real prices</div>
        </div>
        <ChevronRight size={18} />
      </button>

      {loading && <Loading label="Loading offers & recommendations…" />}

      {!loading && offers.length > 0 && (
        <>
          <div className="rm-section-label">For you today</div>
          <div className="rm-offer-row">
            {offers.slice(0, 2).map((o) => {
              const Icon = o.tone === "blue" ? Snowflake : o.tone === "amber" ? Wheat : Gift;
              return (
                <div key={o.id} className={"rm-offer-card " + o.tone}>
                  <Icon size={18} />
                  <div className="rm-offer-title">{o.title}</div>
                  <div className="rm-offer-sub">{o.subtitle}</div>
                </div>
              );
            })}
          </div>
          <button className="rm-mini-btn" style={{ marginBottom: 16 }} onClick={() => onNav("offers")}>See all offers</button>
        </>
      )}

      {!loading && recs.length > 0 && (
        <>
          <div className="rm-section-label">Recommended for you</div>
          <div className="rm-reco-row">
            {recs.map((r) => {
              const Icon = categoryIcon(r.product.category);
              return (
                <div key={r.product.id} className="rm-reco-item green">
                  <div className="rm-reco-icon"><Icon size={16} /></div>
                  <div className="rm-reco-name">{r.product.name}</div>
                  <div className="rm-reco-reason">{r.reason}</div>
                  <div className="rm-reco-price">AED {r.product.price.toFixed(2)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ScreenCustomerList({ token, storeId, onCheckedOut }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/customer/shopping-list", { token })
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  async function toggle(item) {
    try {
      const updated = await apiFetch(`/customer/shopping-list/${item.id}`, { method: "PATCH", token, body: { checked: !item.checked } });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(item) {
    try {
      await apiFetch(`/customer/shopping-list/${item.id}`, { method: "DELETE", token });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function checkout() {
    setCheckingOut(true);
    setError("");
    try {
      const order = await apiFetch("/customer/checkout", { method: "POST", token, body: { store_id: storeId } });
      setReceipt(order);
      load();
      onCheckedOut?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCheckingOut(false);
    }
  }

  const checkedCount = items.filter((i) => i.checked).length;

  if (loading) return <div className="rm-screen"><TopBar title="Shopping List" display /><Loading /></div>;

  return (
    <div className="rm-screen">
      <TopBar title="Shopping List" display />
      <ErrorBanner message={error} />

      {receipt && (
        <div className="rm-reco-card">
          <Sparkles size={16} />
          <div>Checked out — AED {receipt.total.toFixed(2)}, earned {receipt.loyalty_points_earned} loyalty points.</div>
        </div>
      )}

      <div className="rm-card">
        {items.map((item) => (
          <div key={item.id} className="rm-check-row">
            <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} />
            <span>{item.quantity}× {item.product.name}</span>
            <button className="rm-x-btn" style={{ marginLeft: "auto" }} onClick={() => remove(item)}><X size={14} /></button>
          </div>
        ))}
        {items.length === 0 && <div className="rm-empty-mini">Your list is empty — find a product from Home to add one.</div>}
      </div>

      {checkedCount > 0 && (
        <button className="rm-btn-primary rm-w100" onClick={checkout} disabled={checkingOut}>
          {checkingOut ? "Checking out…" : `Checkout ${checkedCount} item${checkedCount !== 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

function ScreenCustomerOffers({ token }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/customer/offers", { token }).then(setOffers).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="rm-screen"><TopBar title="Offers for you" display /><Loading /></div>;

  return (
    <div className="rm-screen">
      <TopBar title="Offers for you" display />
      {offers.map((o) => {
        const Icon = o.tone === "blue" ? Snowflake : o.tone === "amber" ? Wheat : Gift;
        return (
          <div key={o.id} className={"rm-offer-card wide " + o.tone}>
            <Icon size={18} />
            <div>
              <div className="rm-offer-title">{o.title}</div>
              <div className="rm-offer-sub">{o.subtitle}</div>
            </div>
          </div>
        );
      })}
      {offers.length === 0 && <div className="rm-empty-mini">No active offers right now.</div>}
    </div>
  );
}

function ScreenProfile({ roleLabel, name, sub, isEmployee, isAdmin, me, token, stores, storeName, defaultStoreId, onSignOut, onProfileUpdated, onNav }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [receipts, setReceipts] = useState(null);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [bizSnapshot, setBizSnapshot] = useState(null);
  const [bizLoading, setBizLoading] = useState(false);
  const [prefs, setPrefs] = useState({ notify_restock: me.notify_restock, notify_security: me.notify_security, notify_orders: me.notify_orders });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [savingStore, setSavingStore] = useState(false);
  const [error, setError] = useState("");

  function togglePanel(panel) {
    setOpenPanel((p) => (p === panel ? null : panel));
    if (panel === "payments" && !isEmployee && receipts === null) {
      setReceiptsLoading(true);
      apiFetch("/customer/receipts", { token }).then(setReceipts).catch((err) => setError(err.message)).finally(() => setReceiptsLoading(false));
    }
    if (panel === "payments" && isAdmin && bizSnapshot === null) {
      setBizLoading(true);
      apiFetch("/analytics/pnl?days=30", { token }).then(setBizSnapshot).catch((err) => setError(err.message)).finally(() => setBizLoading(false));
    }
  }

  async function savePrefs(next) {
    const prev = prefs;
    setPrefs(next);
    setSavingPrefs(true);
    setError("");
    try {
      const updated = await apiFetch("/auth/me", { method: "PATCH", token, body: next });
      onProfileUpdated(updated);
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 1500);
    } catch (err) {
      setPrefs(prev);
      setError(err.message);
    } finally {
      setSavingPrefs(false);
    }
  }

  async function saveStorePref(storeId) {
    setSavingStore(true);
    setError("");
    try {
      onProfileUpdated(await apiFetch("/auth/me", { method: "PATCH", token, body: { preferred_store_id: storeId } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingStore(false);
    }
  }

  const panelIcon = (panel) => (
    <ChevronRight size={15} style={{ transform: openPanel === panel ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "0 0 auto" }} />
  );

  return (
    <div className="rm-screen">
      <TopBar title="Profile" display />
      <div className="rm-profile-head">
        <div className="rm-avatar big">{name.charAt(0)}</div>
        <div>
          <div className="rm-profile-name">{name}</div>
          <div className="rm-profile-sub">{sub}</div>
          <ShelfTag tone="neutral">{roleLabel}</ShelfTag>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="rm-card" style={{ padding: "4px 14px" }}>
        <div className="rm-check-row" style={{ cursor: "pointer" }} onClick={() => togglePanel("payments")}>
          {isAdmin ? <BarChart3 size={16} /> : <CreditCard size={16} />} <span style={{ flex: 1 }}>{isAdmin ? "Business" : "Payment methods"}</span> {panelIcon("payments")}
        </div>
        {openPanel === "payments" && (
          <div style={{ padding: "0 0 14px" }}>
            {isAdmin ? (
              <>
                {bizLoading && <Loading label="Computing revenue and margin from real orders…" />}
                {bizSnapshot && (
                  <>
                    <div className="rm-login-caption" style={{ textAlign: "left", margin: "0 0 10px" }}>
                      Whole business, last {bizSnapshot.period_days} days — all stores.
                    </div>
                    <div className="rm-sup-tags" style={{ marginBottom: 12 }}>
                      <ShelfTag tone="green">AED {bizSnapshot.net_sales.toLocaleString()} net sales</ShelfTag>
                      <ShelfTag tone={bizSnapshot.gross_profit >= 0 ? "green" : "red"}>AED {bizSnapshot.gross_profit.toLocaleString()} gross profit</ShelfTag>
                      <ShelfTag tone="neutral">{bizSnapshot.margin_pct}% margin</ShelfTag>
                      <ShelfTag tone="neutral">{bizSnapshot.orders} orders</ShelfTag>
                    </div>
                    <button className="rm-mini-btn" onClick={() => onNav("analytics")}>Open full Profit &amp; Loss</button>
                  </>
                )}
              </>
            ) : !isEmployee ? (
              <>
                <div className="rm-login-caption" style={{ textAlign: "left", margin: "0 0 10px" }}>
                  RetailMind never stores card numbers — checkout runs on your loyalty account. This is your real receipt history.
                </div>
                {receiptsLoading && <Loading label="Loading receipts…" />}
                {!receiptsLoading && receipts && receipts.length === 0 && (
                  <div className="rm-empty-mini">No orders yet — check out from your list to see receipts here.</div>
                )}
                {!receiptsLoading && receipts && receipts.slice(0, 8).map((r) => (
                  <div key={r.id} className="rm-mini-note" style={{ marginBottom: 8, alignItems: "flex-start" }}>
                    <CreditCard size={14} style={{ marginTop: 2 }} />
                    <div>
                      <b>AED {r.total.toFixed(2)}</b> · {r.items.length} item{r.items.length !== 1 ? "s" : ""} · +{r.loyalty_points_earned} pts
                      <div style={{ marginTop: 2, color: "var(--ink-soft)" }}>{fmtDate(r.created_at)}</div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="rm-empty-mini">Staff accounts don't hold a purchase history — this is a customer-facing feature.</div>
            )}
          </div>
        )}

        <div className="rm-check-row" style={{ cursor: "pointer" }} onClick={() => togglePanel("notifications")}>
          <Bell size={16} /> <span style={{ flex: 1 }}>Notifications</span> {panelIcon("notifications")}
        </div>
        {openPanel === "notifications" && (
          <div style={{ padding: "0 0 14px" }}>
            {isEmployee ? (
              <>
                <label className="rm-task-check">
                  <input type="checkbox" checked={prefs.notify_restock} disabled={savingPrefs} onChange={(e) => savePrefs({ ...prefs, notify_restock: e.target.checked })} />
                  <div>
                    <div className="rm-task-title">Stock alerts</div>
                    <div className="rm-task-detail">Low stock, out of stock and quality alerts on the Home bell icon</div>
                  </div>
                </label>
                <label className="rm-task-check">
                  <input type="checkbox" checked={prefs.notify_security} disabled={savingPrefs} onChange={(e) => savePrefs({ ...prefs, notify_security: e.target.checked })} />
                  <div>
                    <div className="rm-task-title">Loss prevention alerts</div>
                    <div className="rm-task-detail">Theft and security flags from CCTV monitoring</div>
                  </div>
                </label>
                <label className="rm-task-check">
                  <input type="checkbox" checked={prefs.notify_orders} disabled={savingPrefs} onChange={(e) => savePrefs({ ...prefs, notify_orders: e.target.checked })} />
                  <div>
                    <div className="rm-task-title">Payment notifications</div>
                    <div className="rm-task-detail">Customer checkouts, as they happen</div>
                  </div>
                </label>
                <div className="rm-login-caption" style={{ textAlign: "left", margin: "6px 0 0" }}>
                  {savingPrefs ? "Saving…" : prefsSaved ? "Saved — the bell icon on Home reflects this now." : "Controls what shows up in the bell icon on Home."}
                </div>
              </>
            ) : (
              <div className="rm-empty-mini">Order confirmations show up instantly as receipts above — there's no separate notification feed for customer accounts yet.</div>
            )}
          </div>
        )}

        <div className="rm-check-row" style={{ cursor: "pointer" }} onClick={() => togglePanel("store")}>
          <Store size={16} /> <span style={{ flex: 1 }}>Store preferences</span> {panelIcon("store")}
        </div>
        {openPanel === "store" && (
          <div style={{ padding: "0 0 14px" }}>
            {!isEmployee ? (
              <>
                <div className="rm-login-caption" style={{ textAlign: "left", margin: "0 0 10px" }}>
                  {savingStore ? "Saving…" : me.preferred_store_id ? "This is the store your shopping list checks out against." : "No preference set yet — checkout currently defaults to the store below."}
                </div>
                {stores.map((s) => (
                  <label key={s.id} className="rm-task-check" style={{ cursor: savingStore ? "default" : "pointer" }}>
                    <input type="radio" name="preferred_store" checked={(me.preferred_store_id || defaultStoreId) === s.id} disabled={savingStore} onChange={() => saveStorePref(s.id)} />
                    <div>
                      <div className="rm-task-title">{s.name} {s.code}</div>
                      {(s.region || s.is_headquarters) && <div className="rm-task-detail">{s.region}{s.region && s.is_headquarters ? " · " : ""}{s.is_headquarters ? "Headquarters" : ""}</div>}
                    </div>
                  </label>
                ))}
                {stores.length === 0 && <div className="rm-empty-mini">No stores available yet.</div>}
              </>
            ) : (
              <>
                <div className="rm-empty-mini" style={{ textAlign: "left", padding: "6px 0" }}>
                  You're assigned to <b>{storeName || "no store yet"}</b>. Store assignment is managed from Team &amp; Access{isAdmin ? "." : " by an admin."}
                </div>
                {isAdmin && onNav && (
                  <button className="rm-mini-btn" onClick={() => onNav("team")}>Go to Team &amp; Access</button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <button className="rm-btn-ghost rm-w100" style={{ marginTop: 14 }} onClick={onSignOut}><LogOut size={16} /> Sign out</button>
    </div>
  );
}

/* ----------------------------- employee screens ----------------------------- */

function ScreenEmployeeHome({ member, storeMode, storeName, openAlertsCount, tasks, tasksLoading, onNav, token, storeId }) {
  const isAdmin = member.access_level === "admin";
  const openTasks = tasks.filter((t) => !t.done);
  return (
    <div className="rm-screen">
      <TopBar
        title={"Hi, " + member.name.split(" ")[0]}
        subtitle={storeName ? member.title + " · " + storeName : member.title}
        icon={<NotificationBell token={token} storeId={storeId} />}
        display
      />
      <div className="rm-quick-grid">
        <QuickTile Icon={ShoppingCart} label="Cashier" onClick={() => onNav("cashier")} tone="green" />
        <QuickTile Icon={ClipboardList} label="Tasks" count={openTasks.length} onClick={() => onNav("tasks")} tone="green" />
        <QuickTile Icon={Video} label="CCTV Monitor" count={openAlertsCount} onClick={() => onNav("cctv")} tone="red" />
        <QuickTile Icon={TrendingUp} label="Forecast" onClick={() => onNav("forecast")} tone="blue" />
        <QuickTile Icon={Truck} label="Procurement" onClick={() => onNav("procurement")} tone="plum" />
        <QuickTile Icon={MessageCircle} label="Ask AI" onClick={() => onNav("assistant")} tone="blue" />
        <QuickTile Icon={Package} label="Warehouse" onClick={() => onNav("warehouse")} tone="amber" />
        {isAdmin && <QuickTile Icon={Users} label="Team & Access" onClick={() => onNav("team")} tone="amber" />}
        {isAdmin && <QuickTile Icon={BarChart3} label="Analytics" onClick={() => onNav("analytics")} tone="green" />}
      </div>

      <div className="rm-section-label">My tasks today</div>
      <div className="rm-card">
        {tasksLoading && <Loading label="Loading tasks…" />}
        {!tasksLoading && openTasks.slice(0, 3).map((t) => (
          <div key={t.id} className="rm-task-row">
            <ShelfTag tone={taskTone(t.source)}>{t.source}</ShelfTag>
            <div className="rm-task-title">{t.title}</div>
          </div>
        ))}
        {!tasksLoading && openTasks.length === 0 && <div className="rm-empty-mini">All caught up — nice work.</div>}
      </div>

      {storeMode === "enterprise" && isAdmin && (
        <div className="rm-mini-note"><Building2 size={14} /> Enterprise mode — viewing {storeName}. Switch stores from Team & Access.</div>
      )}
    </div>
  );
}

function ScreenTasks({ tasks, loading, onToggle }) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  if (loading) return <div className="rm-screen"><TopBar title="Tasks" display /><Loading label="Loading tasks…" /></div>;
  return (
    <div className="rm-screen">
      <TopBar title="Tasks" subtitle={open.length + " open today"} display />
      <div className="rm-section-label">Open</div>
      <div className="rm-card">
        {open.map((t) => (
          <label key={t.id} className="rm-task-check">
            <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
            <div>
              <div className="rm-task-title">{t.title}</div>
              <div className="rm-task-detail">{t.detail}</div>
            </div>
            <ShelfTag tone={taskTone(t.source)}>{t.source}</ShelfTag>
          </label>
        ))}
        {open.length === 0 && <div className="rm-empty-mini">Nothing open — great work today.</div>}
      </div>
      {done.length > 0 && (
        <>
          <div className="rm-section-label">Completed</div>
          <div className="rm-card muted">
            {done.map((t) => (
              <label key={t.id} className="rm-task-check">
                <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
                <div className="strike">{t.title}</div>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const BLANK_SUPPLIER = { name: "", category: "Produce", contact_email: "", contact_phone: "", trade_license_no: "", trn: "", payment_terms: "Net 30", cold_chain: "ambient", onboarding_status: "pending" };
const COLD_CHAIN_OPTIONS = ["ambient", "chilled", "frozen", "mixed"];
const ONBOARDING_STATUS_OPTIONS = ["pending", "compliance_review", "approved", "suspended"];
const BLANK_PRODUCT = { sku: "", name: "", category: "Produce", unit: "each", price: "", cost_price: "", reorder_threshold: "10", supplier_id: "" };

function ScreenProcurement({ suppliers, products, orders, loading, onApprove, onReject, canApprove, supplierName, productName, token, storeId, onSuppliersChanged, onProductsChanged }) {
  const [tab, setTab] = useState("orders");
  const drafts = orders.filter((o) => o.status === "draft");
  const history = orders.filter((o) => o.status !== "draft");

  const [reorderNeeded, setReorderNeeded] = useState([]);
  const [contactLog, setContactLog] = useState([]);
  const [notifying, setNotifying] = useState(null);
  const [opError, setOpError] = useState("");

  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState(null);
  const [supplierForm, setSupplierForm] = useState(BLANK_SUPPLIER);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierImportResult, setSupplierImportResult] = useState(null);
  const [importingSuppliers, setImportingSuppliers] = useState(false);

  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [productForm, setProductForm] = useState(BLANK_PRODUCT);
  const [savingProduct, setSavingProduct] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  const loadOutreachData = useCallback(() => {
    if (!storeId) return;
    apiFetch(`/procurement/reorder-needed?store_id=${storeId}`, { token }).then(setReorderNeeded).catch(() => {});
    apiFetch(`/procurement/contact-log?store_id=${storeId}`, { token }).then(setContactLog).catch(() => {});
  }, [storeId, token]);

  useEffect(() => { if (tab === "suppliers") loadOutreachData(); }, [tab, loadOutreachData]);

  async function notify(supplierId, productId, channel) {
    setNotifying(`${supplierId}-${channel}`);
    setOpError("");
    try {
      await apiFetch(`/procurement/suppliers/${supplierId}/notify`, { method: "POST", token, body: { store_id: storeId, channel, product_id: productId } });
      loadOutreachData();
    } catch (err) {
      setOpError(err.message);
    } finally {
      setNotifying(null);
    }
  }

  function openAddSupplier() { setEditingSupplierId(null); setSupplierForm(BLANK_SUPPLIER); setShowSupplierForm(true); }
  function openEditSupplier(s) {
    setEditingSupplierId(s.id);
    setSupplierForm({
      name: s.name, category: s.category, contact_email: s.contact_email || "", contact_phone: s.contact_phone || "",
      trade_license_no: s.trade_license_no || "", trn: s.trn || "", payment_terms: s.payment_terms || "Net 30",
      cold_chain: s.cold_chain || "ambient", onboarding_status: s.onboarding_status || "pending",
    });
    setShowSupplierForm(true);
  }

  async function submitSupplier() {
    if (!supplierForm.name.trim() || savingSupplier) return;
    const email = supplierForm.contact_email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setOpError("Contact email doesn't look like a valid email address."); return; }
    setSavingSupplier(true);
    setOpError("");
    try {
      if (editingSupplierId) {
        await apiFetch(`/procurement/suppliers/${editingSupplierId}`, { method: "PATCH", token, body: supplierForm });
      } else {
        await apiFetch("/procurement/suppliers", { method: "POST", token, body: supplierForm });
      }
      setShowSupplierForm(false);
      onSuppliersChanged();
    } catch (err) {
      setOpError(err.message);
    } finally {
      setSavingSupplier(false);
    }
  }

  async function removeSupplier(id) {
    setOpError("");
    try {
      await apiFetch(`/procurement/suppliers/${id}`, { method: "DELETE", token });
      onSuppliersChanged();
    } catch (err) {
      setOpError(err.message);
    }
  }

  function openAddProduct() { setEditingProductId(null); setProductForm(BLANK_PRODUCT); setShowProductForm(true); }
  function openEditProduct(p) {
    setEditingProductId(p.id);
    setProductForm({ sku: p.sku, name: p.name, category: p.category, unit: p.unit, price: String(p.price), cost_price: p.cost_price != null ? String(p.cost_price) : "", reorder_threshold: String(p.reorder_threshold), supplier_id: p.supplier_id || "" });
    setShowProductForm(true);
  }

  async function submitProduct() {
    if (!productForm.name.trim() || !productForm.sku.trim() || savingProduct) return;
    const price = parseFloat(productForm.price);
    const cost = productForm.cost_price.trim() ? parseFloat(productForm.cost_price) : null;
    const threshold = productForm.reorder_threshold.trim() ? parseInt(productForm.reorder_threshold, 10) : 10;
    if (!Number.isFinite(price) || price <= 0) { setOpError("Price must be greater than 0."); return; }
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) { setOpError("Cost price can't be negative."); return; }
    if (!Number.isInteger(threshold) || threshold < 0) { setOpError("Reorder threshold must be 0 or more."); return; }
    setSavingProduct(true);
    setOpError("");
    const payload = { ...productForm, price, cost_price: cost, reorder_threshold: threshold, supplier_id: productForm.supplier_id || null };
    try {
      if (editingProductId) {
        const { sku, ...updatable } = payload;
        await apiFetch(`/inventory/products/${editingProductId}`, { method: "PATCH", token, body: updatable });
      } else {
        await apiFetch("/inventory/products", { method: "POST", token, body: payload });
      }
      setShowProductForm(false);
      onProductsChanged();
    } catch (err) {
      setOpError(err.message);
    } finally {
      setSavingProduct(false);
    }
  }

  async function removeProduct(id) {
    setOpError("");
    try {
      await apiFetch(`/inventory/products/${id}`, { method: "DELETE", token });
      onProductsChanged();
    } catch (err) {
      setOpError(err.message);
    }
  }

  async function handleCsvFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setOpError("");
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiFetch("/inventory/products/import", { method: "POST", token, formData: form });
      setImportResult(result);
      onProductsChanged();
    } catch (err) {
      setOpError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleSupplierCsvFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setImportingSuppliers(true);
    setOpError("");
    setSupplierImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiFetch("/procurement/suppliers/import", { method: "POST", token, formData: form });
      setSupplierImportResult(result);
      onSuppliersChanged();
    } catch (err) {
      setOpError(err.message);
    } finally {
      setImportingSuppliers(false);
    }
  }

  function itemsSummary(o) {
    if (!o.items.length) return "No line items";
    return o.items.map((it) => `${it.quantity}× ${productName(it.product_id)}`).join(" + ");
  }
  function sourceSummary(o) {
    if (o.forecast_confidence != null) return `${o.created_from} · ${Math.round(o.forecast_confidence * 100)}% confidence`;
    return o.created_from;
  }

  if (loading) return <div className="rm-screen"><TopBar title="Procurement" display /><Loading label="Loading procurement…" /></div>;

  return (
    <div className="rm-screen">
      <TopBar title="Procurement" subtitle={drafts.length + " orders awaiting approval"} display />

      <div className="rm-seg" style={{ marginBottom: 16 }}>
        <button className={"rm-seg-btn" + (tab === "orders" ? " active" : "")} onClick={() => setTab("orders")}>Purchase Orders</button>
        <button className={"rm-seg-btn" + (tab === "suppliers" ? " active" : "")} onClick={() => setTab("suppliers")}>Suppliers</button>
        <button className={"rm-seg-btn" + (tab === "products" ? " active" : "")} onClick={() => setTab("products")}>Products</button>
      </div>

      <ErrorBanner message={opError} />

      {tab === "orders" && (
        <>
          <div className="rm-section-label">Awaiting approval</div>
          {drafts.map((o) => (
            <div key={o.id} className="rm-po-card">
              <div className="rm-po-top">
                <span className="rm-po-id">{o.po_number}</span>
                <span className="rm-po-cost">AED {o.total_cost.toLocaleString()}</span>
              </div>
              <div className="rm-po-supplier">{supplierName(o.supplier_id)}</div>
              <div className="rm-po-items">{itemsSummary(o)}</div>
              <div className="rm-po-meta"><Clock size={11} /> Need by {fmtDate(o.need_by)} · {sourceSummary(o)}</div>
              {canApprove ? (
                <div className="rm-po-actions">
                  <button className="rm-mini-btn reject" onClick={() => onReject(o.id)}>Reject</button>
                  <button className="rm-mini-btn approve" onClick={() => onApprove(o.id)}>Approve</button>
                </div>
              ) : (
                <ShelfTag tone="amber">Pending admin approval</ShelfTag>
              )}
            </div>
          ))}
          {drafts.length === 0 && <div className="rm-empty-mini">No drafts waiting — all caught up.</div>}

          <div className="rm-section-label">History</div>
          {history.map((o) => (
            <div key={o.id} className="rm-po-card muted-card">
              <div className="rm-po-top">
                <span className="rm-po-id">{o.po_number}</span>
                <span className="rm-po-cost">AED {o.total_cost.toLocaleString()}</span>
              </div>
              <div className="rm-po-supplier">{supplierName(o.supplier_id)}</div>
              <div className="rm-po-items" style={{ marginBottom: 4 }}>{itemsSummary(o)}</div>
              <ShelfTag tone={o.status === "approved" ? "blue" : o.status === "rejected" ? "red" : "green"}>
                {o.status === "approved" ? "Sent to supplier" : o.status === "rejected" ? "Rejected" : "Delivered"}
              </ShelfTag>
            </div>
          ))}
          {history.length === 0 && <div className="rm-empty-mini">No history yet.</div>}
        </>
      )}

      {tab === "suppliers" && (
        <>
          {reorderNeeded.length > 0 && (
            <>
              <div className="rm-section-label">Needs reordering ({reorderNeeded.length})</div>
              {reorderNeeded.map((r) => (
                <div key={r.product_id} className="rm-card">
                  <div className="rm-sup-top">
                    <div>
                      <div className="rm-sup-name">{r.product_name}</div>
                      <div className="rm-sup-cat">{r.current_stock} on hand · reorder point {r.reorder_threshold} · {r.supplier_name || "no supplier assigned"}</div>
                    </div>
                    <ShelfTag tone={r.current_stock === 0 ? "red" : "amber"}>{r.current_stock === 0 ? "Stockout" : "Low"}</ShelfTag>
                  </div>
                  {r.supplier_id && (
                    <div className="rm-po-actions">
                      <button className="rm-mini-btn" disabled={notifying === `${r.supplier_id}-email`} onClick={() => notify(r.supplier_id, r.product_id, "email")}>
                        {notifying === `${r.supplier_id}-email` ? "Sending…" : "Notify · Email"}
                      </button>
                      <button className="rm-mini-btn" disabled={notifying === `${r.supplier_id}-call`} onClick={() => notify(r.supplier_id, r.product_id, "call")}>
                        {notifying === `${r.supplier_id}-call` ? "Calling…" : "Notify · Call"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          <div className="rm-section-label" style={{ marginTop: reorderNeeded.length ? 14 : 0 }}>{suppliers.length} suppliers</div>
          <div className="rm-po-actions" style={{ marginBottom: 12 }}>
            <button className="rm-btn-primary" style={{ flex: 1 }} onClick={openAddSupplier}>
              <UserPlus size={16} /> Add supplier
            </button>
            <label className="rm-btn-ghost" style={{ flex: 1, cursor: "pointer" }}>
              <RefreshCw size={16} /> {importingSuppliers ? "Importing…" : "Import CSV"}
              <input type="file" accept=".csv" hidden disabled={importingSuppliers} onChange={handleSupplierCsvFile} />
            </label>
          </div>
          <div className="rm-login-caption" style={{ textAlign: "left", marginBottom: 12 }}>
            Same vendor-onboarding fields a real hypermarket intake sheet collects. Required columns: name, category. Optional: contact_email, contact_phone, trade_license_no, trn, payment_terms, cold_chain (ambient/chilled/frozen/mixed), onboarding_status, performance_score, on_time_pct, late_deliveries_30d.
          </div>
          {supplierImportResult && (
            <div className="rm-reco-card">
              <Sparkles size={16} />
              <div>Imported: {supplierImportResult.created} created, {supplierImportResult.updated} updated.{supplierImportResult.errors.length > 0 ? ` ${supplierImportResult.errors.length} row issue(s): ${supplierImportResult.errors.slice(0, 3).join("; ")}` : ""}</div>
            </div>
          )}

          {showSupplierForm && (
            <div className="rm-card rm-add-form">
              <input className="rm-input full" placeholder="Supplier name" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
              <input className="rm-input full" placeholder="Category (pick one or type a new section)" list="rm-category-options" value={supplierForm.category} onChange={(e) => setSupplierForm({ ...supplierForm, category: e.target.value })} />
              <datalist id="rm-category-options">
                {CATEGORIES.map((c) => <option key={c.id} value={c.id} />)}
              </datalist>
              <input className="rm-input full" placeholder="Contact email" type="email" value={supplierForm.contact_email} onChange={(e) => setSupplierForm({ ...supplierForm, contact_email: e.target.value })} />
              <input className="rm-input full" placeholder="Contact phone" value={supplierForm.contact_phone} onChange={(e) => setSupplierForm({ ...supplierForm, contact_phone: e.target.value })} />
              <input className="rm-input full" placeholder="Trade license no." value={supplierForm.trade_license_no} onChange={(e) => setSupplierForm({ ...supplierForm, trade_license_no: e.target.value })} />
              <input className="rm-input full" placeholder="TRN (Tax Registration Number)" value={supplierForm.trn} onChange={(e) => setSupplierForm({ ...supplierForm, trn: e.target.value })} />
              <input className="rm-input full" placeholder="Payment terms (e.g. Net 30)" value={supplierForm.payment_terms} onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms: e.target.value })} />
              <div className="rm-resp-label">Cold chain</div>
              <div className="rm-seg small" style={{ marginBottom: 14 }}>
                {COLD_CHAIN_OPTIONS.map((c) => (
                  <button key={c} className={"rm-seg-btn" + (supplierForm.cold_chain === c ? " active" : "")} onClick={() => setSupplierForm({ ...supplierForm, cold_chain: c })}>{c}</button>
                ))}
              </div>
              <div className="rm-resp-label">Onboarding status</div>
              <select className="rm-input full" value={supplierForm.onboarding_status} onChange={(e) => setSupplierForm({ ...supplierForm, onboarding_status: e.target.value })}>
                {ONBOARDING_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
              <div className="rm-po-actions">
                <button className="rm-mini-btn" onClick={() => setShowSupplierForm(false)}>Cancel</button>
                <button className="rm-mini-btn approve" onClick={submitSupplier} disabled={savingSupplier}>{savingSupplier ? "Saving…" : editingSupplierId ? "Save changes" : "Add supplier"}</button>
              </div>
            </div>
          )}

          {suppliers.map((s) => {
            const renewDays = daysUntil(s.contract_end);
            return (
              <div key={s.id} className="rm-card">
                <div className="rm-sup-top">
                  <div>
                    <div className="rm-sup-name">{s.name}</div>
                    <div className="rm-sup-cat">{s.category}{s.contact_email ? " · " + s.contact_email : ""}</div>
                    {(s.trade_license_no || s.trn) && (
                      <div className="rm-sup-cat">{s.trade_license_no ? "License " + s.trade_license_no : ""}{s.trade_license_no && s.trn ? " · " : ""}{s.trn ? "TRN " + s.trn : ""}</div>
                    )}
                  </div>
                  <div className="rm-sup-score">
                    <div className="rm-sup-score-num">{s.performance_score}</div>
                    <div className="rm-sup-score-lab">score</div>
                  </div>
                </div>
                <div className="rm-sup-bar-track"><div className="rm-sup-bar-fill" style={{ width: s.performance_score + "%" }} /></div>
                <div className="rm-sup-tags" style={{ marginBottom: 10 }}>
                  <ShelfTag tone={s.onboarding_status === "approved" ? "green" : s.onboarding_status === "suspended" ? "red" : s.onboarding_status === "compliance_review" ? "amber" : "neutral"}>{(s.onboarding_status || "pending").replace("_", " ")}</ShelfTag>
                  <ShelfTag tone={s.on_time_pct >= 95 ? "green" : s.on_time_pct >= 88 ? "amber" : "red"}>{s.on_time_pct.toFixed(0)}% on-time</ShelfTag>
                  {s.late_deliveries_30d > 0 && <ShelfTag tone="red">{s.late_deliveries_30d} late this month</ShelfTag>}
                  {renewDays != null && renewDays <= 30 && <ShelfTag tone="amber">Renews in {renewDays}d</ShelfTag>}
                  {s.cold_chain && s.cold_chain !== "ambient" && <ShelfTag tone="neutral">{s.cold_chain}</ShelfTag>}
                  {s.payment_terms && <ShelfTag tone="neutral">{s.payment_terms}</ShelfTag>}
                </div>
                <div className="rm-po-actions">
                  <button className="rm-mini-btn" onClick={() => openEditSupplier(s)}>Edit</button>
                  <button className="rm-mini-btn reject" onClick={() => removeSupplier(s.id)}>Delete</button>
                </div>
              </div>
            );
          })}
          {suppliers.length === 0 && <div className="rm-empty-mini">No suppliers on file.</div>}

          {contactLog.length > 0 && (
            <>
              <div className="rm-section-label" style={{ marginTop: 14 }}>Outreach log</div>
              {contactLog.map((c) => (
                <div key={c.id} className="rm-mini-note" style={{ marginBottom: 8, alignItems: "flex-start" }}>
                  {c.channel === "email" ? <Mail size={14} style={{ marginTop: 2 }} /> : <Truck size={14} style={{ marginTop: 2 }} />}
                  <div>
                    <b>{supplierName(c.supplier_id)}</b> · {c.channel} · <ShelfTag tone={c.status === "sent" ? "green" : c.status === "failed" ? "red" : "neutral"}>{c.status}</ShelfTag>
                    <div style={{ marginTop: 3 }}>{c.message}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === "products" && (
        <>
          <div className="rm-section-label">{products.length} products</div>
          <div className="rm-po-actions" style={{ marginBottom: 12 }}>
            <button className="rm-btn-primary" style={{ flex: 1 }} onClick={openAddProduct}>
              <UserPlus size={16} /> Add product
            </button>
            <label className="rm-btn-ghost" style={{ flex: 1, cursor: "pointer" }}>
              <RefreshCw size={16} /> {importing ? "Importing…" : "Import CSV"}
              <input type="file" accept=".csv" hidden disabled={importing} onChange={handleCsvFile} />
            </label>
          </div>
          <div className="rm-login-caption" style={{ textAlign: "left", marginBottom: 12 }}>
            Import from a Google Sheet: File → Download → Comma-separated values (.csv), then upload here. Required columns: sku, name, category, price. Optional: barcode, unit, cost_price, reorder_threshold, supplier_name, allergens, dietary_tags (semicolon-separated). cost_price is the landed unit cost — fill it in to get real margin numbers in Analytics → Profit &amp; Loss.
          </div>
          {importResult && (
            <div className="rm-reco-card">
              <Sparkles size={16} />
              <div>Imported: {importResult.created} created, {importResult.updated} updated.{importResult.errors.length > 0 ? ` ${importResult.errors.length} row issue(s): ${importResult.errors.slice(0, 3).join("; ")}` : ""}</div>
            </div>
          )}

          {showProductForm && (
            <div className="rm-card rm-add-form">
              <input className="rm-input full" placeholder="SKU" value={productForm.sku} disabled={!!editingProductId} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} />
              <input className="rm-input full" placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
              <input className="rm-input full" placeholder="Category (pick one or type a new section)" list="rm-category-options" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} />
              <datalist id="rm-category-options">
                {CATEGORIES.map((c) => <option key={c.id} value={c.id} />)}
              </datalist>
              <input className="rm-input full" placeholder="Price (AED)" type="number" min="0" step="0.01" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
              <input className="rm-input full" placeholder="Cost price (AED) — drives real margin in Analytics → P&L" type="number" min="0" step="0.01" value={productForm.cost_price} onChange={(e) => setProductForm({ ...productForm, cost_price: e.target.value })} />
              <input className="rm-input full" placeholder="Reorder threshold" type="number" min="0" value={productForm.reorder_threshold} onChange={(e) => setProductForm({ ...productForm, reorder_threshold: e.target.value })} />
              <select className="rm-input full" value={productForm.supplier_id} onChange={(e) => setProductForm({ ...productForm, supplier_id: e.target.value })}>
                <option value="">No supplier assigned</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <div className="rm-po-actions">
                <button className="rm-mini-btn" onClick={() => setShowProductForm(false)}>Cancel</button>
                <button className="rm-mini-btn approve" onClick={submitProduct} disabled={savingProduct}>{savingProduct ? "Saving…" : editingProductId ? "Save changes" : "Add product"}</button>
              </div>
            </div>
          )}

          {products.map((p) => (
            <div key={p.id} className="rm-card">
              <div className="rm-sup-top">
                <div>
                  <div className="rm-sup-name">{p.name}</div>
                  <div className="rm-sup-cat">
                    {p.sku} · {p.category} · AED {p.price.toFixed(2)} · reorder at {p.reorder_threshold}
                    {p.cost_price != null ? ` · ${Math.round((1 - p.cost_price / p.price) * 100)}% margin` : " · no cost on file"}
                  </div>
                </div>
              </div>
              <div className="rm-po-actions">
                <button className="rm-mini-btn" onClick={() => openEditProduct(p)}>Edit</button>
                <button className="rm-mini-btn reject" onClick={() => removeProduct(p.id)}>Delete</button>
              </div>
            </div>
          ))}
          {products.length === 0 && <div className="rm-empty-mini">No products yet.</div>}
        </>
      )}
    </div>
  );
}

// Tender types a real UAE hypermarket till actually offers — cash, card via
// the terminal, the three NFC wallets with real regional reach, and Tabby,
// the BNPL provider Carrefour/Majid Al Futtaim and most large UAE retailers
// now accept in-store alongside online. Nothing here talks to a card
// network, wallet or BNPL provider — selecting one just records the tender
// type, the same way a till's Z-report buckets a physical sale.
const PAYMENT_METHODS = [
  { id: "cash", label: "Cash", Icon: Banknote },
  { id: "card", label: "Card", Icon: CreditCard },
  { id: "apple_pay", label: "Apple Pay", Icon: Smartphone },
  { id: "google_pay", label: "Google Pay", Icon: Smartphone },
  { id: "samsung_pay", label: "Samsung Pay", Icon: Smartphone },
  { id: "tabby", label: "Tabby (BNPL)", Icon: Wallet },
];
const PAYMENT_METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m.label]));
const BLANK_NEW_CUSTOMER = { name: "", phone: "", email: "" };

function ScreenCashier({ token, storeId, storeName, products }) {
  const [tab, setTab] = useState("checkout");
  return (
    <div className="rm-screen">
      <TopBar title="Cashier" subtitle={(storeName ? storeName + " · " : "") + "Register"} display />
      <div className="rm-seg" style={{ marginBottom: 16 }}>
        <button className={"rm-seg-btn" + (tab === "checkout" ? " active" : "")} onClick={() => setTab("checkout")}>Checkout</button>
        <button className={"rm-seg-btn" + (tab === "customers" ? " active" : "")} onClick={() => setTab("customers")}>Customers</button>
      </div>
      {tab === "checkout" && <CashierCheckout token={token} storeId={storeId} products={products} />}
      {tab === "customers" && <CustomerDirectory token={token} />}
    </div>
  );
}

function CashierCheckout({ token, storeId, products }) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);

  const [customer, setCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState(BLANK_NEW_CUSTOMER);
  const [enrolling, setEnrolling] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState("");

  const [paymentMethod, setPaymentMethod] = useState(null);
  const [amountTendered, setAmountTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || "").includes(q))
      .slice(0, 8);
  }, [search, products]);

  useEffect(() => {
    if (customer) return;
    if (customerSearch.trim().length < 1) { setCustomerResults([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch(`/pos/customers?search=${encodeURIComponent(customerSearch.trim())}`, { token })
        .then((res) => { if (!cancelled) setCustomerResults(res); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [customerSearch, customer, token]);

  function addToCart(product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) return prev.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product, qty: 1 }];
    });
    setSearch("");
  }
  function changeQty(productId, delta) {
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qty: Math.min(999, Math.max(1, l.qty + delta)) } : l)));
  }
  function removeLine(productId) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  function attachCustomer(c) {
    setCustomer(c);
    setCustomerSearch("");
    setCustomerResults([]);
    setRedeemPoints("");
  }

  async function submitNewCustomer() {
    if (!newCustomerForm.name.trim() || !newCustomerForm.phone.trim() || enrolling) return;
    setEnrolling(true);
    setError("");
    try {
      const created = await apiFetch("/pos/customers", {
        method: "POST", token,
        body: { name: newCustomerForm.name, phone: newCustomerForm.phone, email: newCustomerForm.email || undefined },
      });
      attachCustomer(created);
      setShowNewCustomer(false);
      setNewCustomerForm(BLANK_NEW_CUSTOMER);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnrolling(false);
    }
  }

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const maxRedeemable = customer ? Math.min(customer.loyalty_points || 0, Math.floor(subtotal / 0.01)) : 0;
  const effectivePoints = Math.max(0, Math.min(Number(redeemPoints) || 0, maxRedeemable));
  const discount = effectivePoints * 0.01;
  const total = Math.max(0, subtotal - discount);
  const changeDue = (Number(amountTendered) || 0) - total;

  async function completeSale() {
    if (cart.length === 0 || !paymentMethod || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const body = {
        store_id: storeId,
        customer_id: customer?.id || null,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
        payment_method: paymentMethod,
        points_to_redeem: effectivePoints,
      };
      if (paymentMethod === "cash") body.amount_tendered = Number(amountTendered) || 0;
      const order = await apiFetch("/pos/checkout", { method: "POST", token, body });
      setReceipt(order);
      setCart([]); setCustomer(null); setCustomerSearch(""); setRedeemPoints("");
      setPaymentMethod(null); setAmountTendered("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <div className="rm-receipt-card">
        <div className="rm-section-label" style={{ marginTop: 0 }}>Sale complete</div>
        <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 4 }}>AED {receipt.total.toFixed(2)}</div>
        <div className="rm-login-caption" style={{ textAlign: "left", margin: "0 0 12px" }}>
          {receipt.customer_name} · {PAYMENT_METHOD_LABEL[receipt.payment_method] || receipt.payment_method}
          {receipt.payment_method === "cash" && receipt.change_due > 0 ? ` · Change due AED ${receipt.change_due.toFixed(2)}` : ""}
        </div>
        {receipt.items.map((it) => (
          <div key={it.product_id} className="rm-cart-row">
            <div style={{ flex: 1 }} className="rm-cart-name">{it.quantity}× {it.product.name}</div>
            <div className="rm-cart-line-total">AED {(it.unit_price * it.quantity).toFixed(2)}</div>
          </div>
        ))}
        {receipt.loyalty_points_earned > 0 && (
          <div className="rm-mini-note" style={{ marginTop: 10 }}>
            <Sparkles size={14} /> {receipt.loyalty_points_earned} loyalty points earned{receipt.points_redeemed > 0 ? ` · ${receipt.points_redeemed} redeemed` : ""}
          </div>
        )}
        <button className="rm-btn-primary rm-w100" onClick={() => setReceipt(null)}><ShoppingCart size={16} /> New sale</button>
      </div>
    );
  }

  return (
    <div className="rm-pos-layout">
      <div className="rm-pos-main">
        <div className="rm-card">
          <input className="rm-input full" placeholder="Search products by name, SKU or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: search.trim() ? 4 : 0 }} />
          {search.trim() && (
            <div className="rm-pos-results">
              {filteredProducts.map((p) => (
                <div key={p.id} className="rm-check-row" style={{ cursor: "pointer" }} onClick={() => addToCart(p)}>
                  <span>{p.name}</span>
                  <span style={{ marginLeft: "auto", color: "var(--ink-soft)", fontWeight: 700, fontSize: 12.5 }}>AED {p.price.toFixed(2)}</span>
                </div>
              ))}
              {filteredProducts.length === 0 && <div className="rm-empty-mini">No matches.</div>}
            </div>
          )}
        </div>

        <div className="rm-section-label">Cart{cart.length > 0 ? ` (${cart.reduce((s, l) => s + l.qty, 0)} items)` : ""}</div>
        <div className="rm-card">
          {cart.map((line) => (
            <div key={line.product.id} className="rm-cart-row">
              <div style={{ flex: 1 }}>
                <div className="rm-cart-name">{line.product.name}</div>
                <div className="rm-cart-price">AED {line.product.price.toFixed(2)} / {line.product.unit}</div>
              </div>
              <div className="rm-qty-stepper">
                <button className="rm-qty-btn" onClick={() => changeQty(line.product.id, -1)}><Minus size={13} /></button>
                <span className="rm-qty-num">{line.qty}</span>
                <button className="rm-qty-btn" onClick={() => changeQty(line.product.id, 1)}><Plus size={13} /></button>
              </div>
              <div className="rm-cart-line-total">AED {(line.product.price * line.qty).toFixed(2)}</div>
              <button className="rm-cart-remove" onClick={() => removeLine(line.product.id)}><X size={15} /></button>
            </div>
          ))}
          {cart.length === 0 && <div className="rm-empty-mini">Search above to add items to this sale.</div>}
        </div>
      </div>

      <div className="rm-pos-side">
        <div className="rm-card">
          <div className="rm-mode-label">Customer (optional)</div>
          {customer ? (
            <div className="rm-customer-chip">
              <div style={{ flex: 1 }}>
                <div className="rm-customer-chip-name">{customer.name}</div>
                <div className="rm-customer-chip-sub">{customer.phone || customer.email} · {customer.loyalty_points} pts</div>
              </div>
              <button className="rm-mini-btn" onClick={() => { setCustomer(null); setRedeemPoints(""); }}>Change</button>
            </div>
          ) : (
            <>
              <input className="rm-input full" placeholder="Search by name or phone…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
              {customerSearch.trim() && (
                <div className="rm-pos-results">
                  {customerResults.map((c) => (
                    <div key={c.id} className="rm-check-row" style={{ cursor: "pointer" }} onClick={() => attachCustomer(c)}>
                      <span>{c.name}</span>
                      <span style={{ marginLeft: "auto", color: "var(--ink-soft)", fontWeight: 700, fontSize: 12 }}>{c.phone || c.email}</span>
                    </div>
                  ))}
                  {customerResults.length === 0 && <div className="rm-empty-mini">No match — walk-in sale, or enroll them below.</div>}
                </div>
              )}
              {!showNewCustomer && <button className="rm-mini-btn" onClick={() => setShowNewCustomer(true)}>+ New customer</button>}
            </>
          )}

          {showNewCustomer && !customer && (
            <div style={{ marginTop: 10 }}>
              <input className="rm-input full" placeholder="Name" value={newCustomerForm.name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} />
              <input className="rm-input full" placeholder="Phone number" value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} />
              <input className="rm-input full" placeholder="Email (optional)" type="email" value={newCustomerForm.email} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} />
              <div className="rm-po-actions">
                <button className="rm-mini-btn" onClick={() => setShowNewCustomer(false)}>Cancel</button>
                <button className="rm-mini-btn approve" onClick={submitNewCustomer} disabled={enrolling}>{enrolling ? "Enrolling…" : "Enroll & attach"}</button>
              </div>
            </div>
          )}

          {customer && customer.loyalty_points > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="rm-mode-label">Redeem points ({customer.loyalty_points} available · 100 pts = AED 1)</div>
              <input className="rm-input full" type="number" min="0" max={customer.loyalty_points} placeholder="0" value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} style={{ marginBottom: 0 }} />
            </div>
          )}
        </div>

        <div className="rm-card">
          <div className="rm-mode-label">Payment method</div>
          <div className="rm-pay-grid">
            {PAYMENT_METHODS.map((m) => (
              <button key={m.id} className={"rm-pay-btn" + (paymentMethod === m.id ? " active" : "")} onClick={() => setPaymentMethod(m.id)}>
                <m.Icon size={18} /> {m.label}
              </button>
            ))}
          </div>
          {paymentMethod === "cash" && (
            <input className="rm-input full" type="number" min="0" step="0.01" placeholder="Amount tendered (AED)" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} />
          )}

          <div className="rm-pos-totals">
            <div className="rm-pos-total-row"><span>Subtotal</span><span>AED {subtotal.toFixed(2)}</span></div>
            {discount > 0 && <div className="rm-pos-total-row"><span>Points discount</span><span>-AED {discount.toFixed(2)}</span></div>}
            <div className="rm-pos-total-row grand"><span>Total</span><span>AED {total.toFixed(2)}</span></div>
            {paymentMethod === "cash" && Number(amountTendered) > 0 && (
              <div className="rm-pos-total-row"><span>Change due</span><span>AED {Math.max(0, changeDue).toFixed(2)}</span></div>
            )}
          </div>

          <ErrorBanner message={error} />
          <button className="rm-btn-primary rm-w100" disabled={cart.length === 0 || !paymentMethod || submitting} onClick={completeSale}>
            {submitting ? "Processing…" : `Complete sale · AED ${total.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomerDirectory({ token }) {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState(BLANK_NEW_CUSTOMER);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/pos/customers${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`, { token })
      .then(setCustomers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [search, token]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  function openDetail(id) {
    setDetailLoading(true);
    setError("");
    apiFetch(`/pos/customers/${id}`, { token }).then(setSelected).catch((err) => setError(err.message)).finally(() => setDetailLoading(false));
  }

  async function submitNewCustomer() {
    if (!newCustomerForm.name.trim() || !newCustomerForm.phone.trim() || enrolling) return;
    setEnrolling(true);
    setError("");
    try {
      const created = await apiFetch("/pos/customers", {
        method: "POST", token,
        body: { name: newCustomerForm.name, phone: newCustomerForm.phone, email: newCustomerForm.email || undefined },
      });
      setShowNewCustomer(false);
      setNewCustomerForm(BLANK_NEW_CUSTOMER);
      load();
      setSelected(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnrolling(false);
    }
  }

  if (selected) {
    return (
      <div>
        <button className="rm-mini-btn" style={{ marginBottom: 12 }} onClick={() => setSelected(null)}><ChevronLeft size={14} /> Back to directory</button>
        {detailLoading && <Loading label="Loading customer…" />}
        <div className="rm-card">
          <div className="rm-profile-head" style={{ marginBottom: 10 }}>
            <div className="rm-avatar big">{selected.name.charAt(0)}</div>
            <div>
              <div className="rm-profile-name">{selected.name}</div>
              <div className="rm-profile-sub">{selected.phone || "No phone on file"}{selected.email ? " · " + selected.email : ""}</div>
              <ShelfTag tone="green">{loyaltyTier(selected.loyalty_points)} · {selected.loyalty_points} pts</ShelfTag>
            </div>
          </div>
          <div className="rm-sup-tags">
            <ShelfTag tone="neutral">{selected.total_orders} order{selected.total_orders !== 1 ? "s" : ""}</ShelfTag>
            <ShelfTag tone="neutral">Member since {fmtDate(selected.member_since)}</ShelfTag>
          </div>
        </div>

        <div className="rm-section-label" style={{ marginTop: 14 }}>Order history</div>
        {(selected.orders || []).map((o) => (
          <div key={o.id} className="rm-mini-note" style={{ marginBottom: 8, alignItems: "flex-start" }}>
            <Receipt size={14} style={{ marginTop: 2 }} />
            <div>
              <b>AED {o.total.toFixed(2)}</b> · {o.items.length} item{o.items.length !== 1 ? "s" : ""} · {PAYMENT_METHOD_LABEL[o.payment_method] || (o.channel === "self_checkout" ? "Self-checkout" : "—")}
              {o.cashier_name ? ` · rung up by ${o.cashier_name}` : ""}
              <div style={{ marginTop: 2, color: "var(--ink-soft)" }}>{fmtDate(o.created_at)}</div>
            </div>
          </div>
        ))}
        {(selected.orders || []).length === 0 && <div className="rm-empty-mini">No orders yet.</div>}
      </div>
    );
  }

  return (
    <div>
      <input className="rm-input full" placeholder="Search by name, phone or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {!showNewCustomer && (
        <button className="rm-btn-ghost rm-w100" style={{ marginBottom: 12, marginTop: 0 }} onClick={() => setShowNewCustomer(true)}>
          <UserPlus size={16} /> New customer
        </button>
      )}

      {showNewCustomer && (
        <div className="rm-card rm-add-form">
          <input className="rm-input full" placeholder="Name" value={newCustomerForm.name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} />
          <input className="rm-input full" placeholder="Phone number" value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} />
          <input className="rm-input full" placeholder="Email (optional)" type="email" value={newCustomerForm.email} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} />
          <div className="rm-po-actions">
            <button className="rm-mini-btn" onClick={() => setShowNewCustomer(false)}>Cancel</button>
            <button className="rm-mini-btn approve" onClick={submitNewCustomer} disabled={enrolling}>{enrolling ? "Enrolling…" : "Enroll customer"}</button>
          </div>
        </div>
      )}

      <ErrorBanner message={error} />
      {loading && <Loading label="Loading customers…" />}
      {!loading && customers.map((c) => (
        <div key={c.id} className="rm-card" style={{ cursor: "pointer" }} onClick={() => openDetail(c.id)}>
          <div className="rm-sup-top">
            <div>
              <div className="rm-sup-name">{c.name}</div>
              <div className="rm-sup-cat">{c.phone || "No phone"}{c.email ? " · " + c.email : ""}</div>
            </div>
            <ShelfTag tone="green">{c.loyalty_points} pts</ShelfTag>
          </div>
          <div className="rm-sup-tags">
            <ShelfTag tone="neutral">{c.total_orders} order{c.total_orders !== 1 ? "s" : ""}</ShelfTag>
            {c.last_order_at && <ShelfTag tone="neutral">Last order {fmtDate(c.last_order_at)}</ShelfTag>}
          </div>
        </div>
      ))}
      {!loading && customers.length === 0 && <div className="rm-empty-mini">No customers found.</div>}
    </div>
  );
}

function ScreenWarehouse({ token, storeId }) {
  const [zones, setZones] = useState([]);
  const [route, setRoute] = useState([]);
  const [congestion, setCongestion] = useState([]);
  const [staffing, setStaffing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch(`/warehouse/zones?store_id=${storeId}`, { token }),
      apiFetch(`/warehouse/pick-route?store_id=${storeId}`, { token }),
      apiFetch(`/warehouse/congestion?store_id=${storeId}`, { token }),
      apiFetch(`/warehouse/staffing?store_id=${storeId}`, { token }),
    ])
      .then(([z, r, c, s]) => { if (!cancelled) { setZones(z); setRoute(r); setCongestion(c); setStaffing(s); } })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load warehouse data"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storeId, token]);

  if (loading) return <div className="rm-screen"><TopBar title="Warehouse" display /><Loading label="Computing zone utilization, pick route & traffic…" /></div>;

  return (
    <div className="rm-screen">
      <TopBar title="Warehouse" subtitle="Storage, picking & workforce planning" display />
      <ErrorBanner message={error} />

      <div className="rm-section-label">Storage utilization</div>
      <div className="rm-card">
        {zones.map((z) => (
          <div key={z.id} className="rm-waste-row">
            <span className="rm-waste-name" style={{ width: 190 }}>{z.name}</span>
            <div className="rm-waste-track">
              <div className="rm-waste-fill" style={{ width: Math.min(100, z.pct) + "%", background: z.pct >= 90 ? "var(--red)" : z.pct >= 75 ? "var(--amber)" : "var(--green)" }} />
            </div>
            <span className="rm-waste-pct">{z.pct}%</span>
          </div>
        ))}
        {zones.length === 0 && <div className="rm-empty-mini">No zones configured for this store.</div>}
      </div>

      <div className="rm-section-label">Real-time pick route ({route.length} stops)</div>
      <div className="rm-card">
        {route.map((r) => (
          <div key={r.step} className="rm-route-row">
            <div className="rm-route-step">{r.step}</div>
            <div>
              <div className="rm-route-loc"><MapPin size={11} /> {r.location}</div>
              <div className="rm-route-task">{r.task}</div>
            </div>
          </div>
        ))}
        {route.length === 0 && <div className="rm-empty-mini">Nothing needs attention right now — no route to run.</div>}
      </div>
      <div className="rm-mini-note" style={{ marginBottom: 14 }}>
        <Clock size={14} /> Built live from open alerts and batches expiring within 3 days, ordered by aisle number.
      </div>

      <div className="rm-section-label">Floor traffic by hour (last 21 days, averaged)</div>
      <div className="rm-card chart-card">
        {congestion.length === 0 ? <div className="rm-empty-mini">No transaction history yet.</div> : (
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={congestion} margin={{ top: 6, right: 6, left: -28, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 5" stroke="rgba(22,32,26,0.08)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 9.5, fill: "#8C9188" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(22,32,26,0.1)", fontSize: 12 }} formatter={(v, n, p) => [p.payload.transaction_count + " avg transactions/hr", "Traffic"]} />
              <Bar dataKey="level" radius={[5, 5, 0, 0]}>
                {congestion.map((c) => <Cell key={c.hour} fill={c.level >= 70 ? "#B93A2C" : c.level >= 50 ? "#C9791E" : "#2E7D4F"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {staffing && (
        <div className="rm-mini-note"><Users size={14} /> Recommended {staffing.day} floor staff: {staffing.recommended_staff} (baseline {staffing.baseline_staff}) — {staffing.reason}</div>
      )}
    </div>
  );
}

const CAMERA_SOURCE_KEY = "rm_camera_source";

function CameraFeed({ source }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    if (source?.type !== "webcam") return;
    let stream;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser connection can't use the webcam — camera access needs https:// or localhost.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch((err) => setError(err.message || "Couldn't access this device's camera — check browser permissions."));
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [source]);

  if (!source || source.type === "none") return null;
  return (
    <div className="rm-card" style={{ padding: 8, marginBottom: 14 }}>
      <ErrorBanner message={error} />
      {source.type === "webcam" && !error && (
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 12, display: "block", background: "#0F1712" }} />
      )}
      {source.type === "url" && !error && (
        <img
          src={source.url} alt="Live camera feed" style={{ width: "100%", borderRadius: 12, display: "block", background: "#0F1712" }}
          onError={() => setError("Couldn't load that stream. It needs to be a direct HTTP(S) MJPEG/snapshot URL — plain rtsp:// links can't play in a browser without a separate streaming gateway.")}
        />
      )}
    </div>
  );
}

function ScreenCCTV({ token, storeId, alerts, loading, onResolve, storeName, assigneeName }) {
  const [shelfFill, setShelfFill] = useState([]);
  const [cameraSource, setCameraSource] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CAMERA_SOURCE_KEY) || "null"); } catch { return null; }
  });
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [urlDraft, setUrlDraft] = useState(cameraSource?.type === "url" ? cameraSource.url : "");
  const openAlerts = alerts.filter((a) => a.status !== "resolved");

  useEffect(() => {
    apiFetch(`/inventory/shelf-fill?store_id=${storeId}`, { token }).then(setShelfFill).catch(() => {});
  }, [storeId, token]);

  function saveCameraSource(next) {
    setCameraSource(next);
    localStorage.setItem(CAMERA_SOURCE_KEY, JSON.stringify(next));
    setShowUrlInput(false);
  }

  if (loading) return <div className="rm-screen"><TopBar title="Live Monitoring" display /><Loading label="Loading alerts…" /></div>;
  return (
    <div className="rm-screen">
      <TopBar title="Live Monitoring" subtitle={storeName + " · AI Vision"} display />

      <div className="rm-mode-card">
        <div className="rm-mode-label">Camera source</div>
        <div className="rm-seg small">
          <button className={"rm-seg-btn" + (cameraSource?.type === "webcam" ? " active" : "")} onClick={() => saveCameraSource({ type: "webcam" })}>This device's webcam</button>
          <button className={"rm-seg-btn" + (cameraSource?.type === "url" ? " active" : "")} onClick={() => setShowUrlInput(true)}>IP camera URL</button>
        </div>
        {showUrlInput && (
          <div style={{ marginTop: 10 }}>
            <ErrorBanner message={urlError} />
            <input className="rm-input full" placeholder="http://camera-ip/video.mjpg" aria-label="IP camera URL" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
            <div className="rm-login-caption" style={{ textAlign: "left", marginBottom: 8 }}>
              Use your camera's HTTP MJPEG or snapshot URL — most IP cameras (Reolink, Hikvision, Dahua, etc.) expose one alongside RTSP. A plain rtsp:// link can't play directly in a browser; that needs a separate streaming gateway.
            </div>
            <button className="rm-btn-primary rm-w100" onClick={() => {
              const url = urlDraft.trim();
              if (!/^https?:\/\/\S+$/i.test(url)) { setUrlError("Enter a full http:// or https:// camera URL."); return; }
              setUrlError("");
              saveCameraSource({ type: "url", url });
            }}>Save & connect</button>
          </div>
        )}
        {cameraSource && cameraSource.type !== "none" && (
          <button className="rm-mini-btn" style={{ marginTop: 10 }} onClick={() => saveCameraSource(null)}>Turn off camera</button>
        )}
      </div>
      <CameraFeed source={cameraSource} />

      <div className="rm-legend-row">
        <div className="rm-legend-chip"><b>YOLO</b> detects & counts</div>
        <div className="rm-legend-chip"><b>SAM</b> segments shelf space</div>
        <div className="rm-legend-chip"><b>ViT</b> classifies quality & behavior</div>
      </div>
      <div className="rm-review-note"><ShieldCheck size={14} /> AI flags exceptions for your team to verify — nothing here is auto-actioned. Tiles below show real shelf-fill computed from live inventory — the alerts are real rows too. The YOLO / SAM / ViT chips describe the intended vision pipeline — no camera models are running in this build.</div>

      <div className="rm-cam-grid">
        {shelfFill.map((f) => (
          <div key={f.location} className={"rm-cam-tile " + (f.pct < 30 ? "red" : f.pct < 60 ? "amber" : "green")}>
            <div className="rm-cam-live"><span className="dot" />INVENTORY</div>
            <div className="rm-cam-name">{f.location} · {f.category}</div>
            <div className="rm-cam-fill">{f.pct}% stocked</div>
          </div>
        ))}
        {shelfFill.length === 0 && <div className="rm-empty-mini">No inventory data for this store yet.</div>}
      </div>

      <div className="rm-section-label">AI alerts ({openAlerts.length} open)</div>
      {openAlerts.map((a) => (
        <div key={a.id} className="rm-alert-card">
          <div className="rm-alert-top">
            <ShelfTag tone={a.severity}>{a.kind === "theft" ? "Loss prevention" : a.kind === "quality" ? "Quality" : "Stock"}</ShelfTag>
            <span className="rm-alert-conf">{a.confidence.toFixed(0)}% confidence</span>
          </div>
          <div className="rm-alert-msg">{a.message}</div>
          <div className="rm-alert-meta"><MapPin size={12} /> {a.location} · <span className="rm-alert-model">{a.model_source}</span> · {fmtTime(a.created_at)}</div>
          <div className="rm-alert-bottom">
            <span className="rm-alert-assigned">Notified: {assigneeName(a.assigned_to)}</span>
            <button className="rm-mini-btn" onClick={() => onResolve(a.id)}>Mark reviewed</button>
          </div>
        </div>
      ))}
      {openAlerts.length === 0 && <div className="rm-empty-mini">No open alerts — all clear.</div>}
    </div>
  );
}

function ScreenForecast({ token, storeId }) {
  const [modelId, setModelId] = useState("tft");
  const [catId, setCatId] = useState("Dairy & Chilled");
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | unavailable | error
  const [error, setError] = useState("");
  const model = MODELS.find((m) => m.id === modelId);
  const cat = CATEGORIES.find((c) => c.id === catId);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    apiFetch(`/forecast/${encodeURIComponent(catId)}?store_id=${storeId}&model=${modelId}&horizon_days=7`, { token })
      .then((res) => { if (!cancelled) { setResult(res); setStatus("ok"); } })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 501) { setStatus("unavailable"); setError(err.message); }
        else { setStatus("error"); setError(err.message || "Failed to load forecast"); }
      });
    return () => { cancelled = true; };
  }, [catId, modelId, storeId, token]);

  const data = useMemo(() => {
    if (!result) return [];
    return result.points.map((p) => ({
      label: p.label, actual: p.actual, predicted: p.predicted,
      band: p.band_low != null && p.band_high != null ? [p.band_low, p.band_high] : null,
    }));
  }, [result]);

  return (
    <div className="rm-screen">
      <TopBar title="Forecast Studio" subtitle="Demand prediction & auto-reorder" display />

      <div className="rm-cat-row">
        {CATEGORIES.map((c) => (
          <button key={c.id} className={"rm-cat-chip " + c.tone + (c.id === catId ? " active" : "")} onClick={() => setCatId(c.id)}>
            <c.Icon size={14} /> {c.id}
          </button>
        ))}
      </div>

      <div className="rm-model-tabs">
        {MODELS.map((m) => (
          <button key={m.id} className={"rm-model-tab" + (m.id === modelId ? " active" : "")} onClick={() => setModelId(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="rm-model-desc">{model.desc}</div>

      {status === "loading" && <div className="rm-card chart-card"><Loading label="Training models on live sales data — this can take up to ~20 seconds…" /></div>}

      {status === "unavailable" && (
        <div className="rm-mini-note" style={{ marginBottom: 14 }}>
          <AlertTriangle size={14} /> {model.label} isn't available yet — {error} The frontend shows this honestly instead of faking a chart.
        </div>
      )}

      {status === "error" && <ErrorBanner message={error} />}

      {status === "ok" && (
        <>
          <div className="rm-card chart-card">
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={data} margin={{ top: 6, right: 6, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" stroke="rgba(22,32,26,0.08)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#8C9188" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#8C9188" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(22,32,26,0.1)", fontSize: 12 }} />
                <Area type="monotone" dataKey="band" stroke="none" fill="#376C93" fillOpacity={0.15} />
                <Line type="monotone" dataKey="actual" stroke="#16201A" strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="predicted" stroke="#2E7D4F" strokeWidth={2.5} strokeDasharray="5 4" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="rm-chart-legend">
              <span><i className="dot ink" /> Actual</span>
              <span><i className="dot green" /> Predicted</span>
              <span><i className="dot blue" /> Confidence band</span>
            </div>
          </div>

          <div className="rm-reco-card">
            <Sparkles size={16} />
            <div>{result.recommendation}{result.recommended_po_quantity ? ` Suggested reorder: ${result.recommended_po_quantity} units.` : ""}</div>
          </div>

          <div className="rm-mlops-strip">
            <RefreshCw size={12} /> Rolling MAPE {result.mape != null ? `${result.mape.toFixed(1)}%` : "not enough data yet"} · trained live from sales_records{result.confidence != null ? ` · ${Math.round(result.confidence * 100)}% confidence` : ""}
          </div>
        </>
      )}
    </div>
  );
}

function ScreenAssistant({ token, storeId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const suggestions = [
    "Which products need attention this week?",
    "Which supplier performs best?",
    "Is dairy demand actually decreasing?",
    "Any security concerns today?",
    "What should I restock first?",
  ];

  async function ask(text) {
    const q = text.trim();
    if (!q || pending) return;
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    try {
      const answer = await apiFetch("/assistant/ask", { method: "POST", token, body: { question: q, store_id: storeId } });
      setMessages((prev) => [...prev, { role: "assistant", text: answer.text, agent: answer.agent, tone: answer.tone }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: "Couldn't reach the assistant: " + (err.message || "request failed"), agent: "RetailMind Assistant", tone: "red" }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rm-screen">
      <TopBar title="Ask RetailMind" subtitle="Multi-agent · grounded in live store data, not an LLM" display />

      {messages.length === 0 && (
        <div className="rm-mini-note" style={{ marginBottom: 14 }}>
          <MessageCircle size={14} /> Each answer below queries Postgres directly — inventory, suppliers, forecasts and today's alerts — no external model, no canned copy.
        </div>
      )}

      {messages.map((m, i) => (
        <div key={i} className={"rm-chat-msg-wrap " + m.role}>
          {m.role === "assistant" && (
            <div className="rm-chat-agent-tag"><ShelfTag tone={m.tone}>{m.agent}</ShelfTag></div>
          )}
          <div className={"rm-chat-bubble " + m.role}>{m.text}</div>
        </div>
      ))}
      {pending && <div className="rm-chat-msg-wrap assistant"><Loading label="Querying store data…" /></div>}

      <div className="rm-chat-suggestions">
        {suggestions.map((s) => (
          <button key={s} className="rm-chat-suggestion" onClick={() => ask(s)} disabled={pending}>{s}</button>
        ))}
      </div>

      <div className="rm-chat-input-row">
        <input
          className="rm-chat-input"
          placeholder="Ask about stock, suppliers, forecasts…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(input); }}
          disabled={pending}
        />
        <button className="rm-chat-send" onClick={() => ask(input)} disabled={pending}><Send size={17} /></button>
      </div>
    </div>
  );
}

function ScreenAnalytics({ token, storeMode, activeStoreId, activeStoreName }) {
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [movers, setMovers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pnl, setPnl] = useState(null);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [pnlError, setPnlError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = storeMode === "enterprise" ? "" : `?store_id=${activeStoreId}`;
    apiFetch(`/analytics/summary${qs}`, { token })
      .then((res) => { if (!cancelled) setSummary(res); })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load analytics"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (storeMode !== "enterprise" && activeStoreId) {
      apiFetch(`/analytics/movers?store_id=${activeStoreId}`, { token }).then((res) => { if (!cancelled) setMovers(res); }).catch(() => {});
    } else {
      setMovers(null);
    }
    return () => { cancelled = true; };
  }, [storeMode, activeStoreId, token]);

  useEffect(() => {
    let cancelled = false;
    setPnlLoading(true);
    const qs = storeMode === "enterprise" ? "?days=30" : `?store_id=${activeStoreId}&days=30`;
    apiFetch(`/analytics/pnl${qs}`, { token })
      .then((res) => { if (!cancelled) setPnl(res); })
      .catch((err) => { if (!cancelled) setPnlError(err.message || "Failed to load profit & loss"); })
      .finally(() => { if (!cancelled) setPnlLoading(false); });
    return () => { cancelled = true; };
  }, [storeMode, activeStoreId, token]);

  return (
    <div className="rm-screen">
      <TopBar title="Store Analytics" subtitle={(storeMode === "enterprise" ? "All stores" : activeStoreName) + " · last 7 days"} display />

      <div className="rm-seg" style={{ marginBottom: 16 }}>
        <button className={"rm-seg-btn" + (tab === "overview" ? " active" : "")} onClick={() => setTab("overview")}>Overview</button>
        <button className={"rm-seg-btn" + (tab === "pnl" ? " active" : "")} onClick={() => setTab("pnl")}>Profit &amp; Loss</button>
      </div>

      {tab === "overview" && (
      <>
      {loading && <Loading label="Crunching sales_records…" />}
      <ErrorBanner message={error} />

      {summary && (
        <>
          <div className="rm-kpi-grid">
            {summary.kpis.map((k) => (
              <div key={k.label} className="rm-kpi-card">
                <div className="rm-kpi-label">{k.label}</div>
                <div className="rm-kpi-value">{k.value}</div>
                <div className={"rm-kpi-delta" + (k.good ? " good" : " bad")}>{k.delta}</div>
              </div>
            ))}
          </div>

          {movers && (
            <>
              <div className="rm-section-label">Selling out fast (last 14 days)</div>
              <div className="rm-card">
                {movers.map((m) => (
                  <div key={m.product_id} className="rm-team-row">
                    <div className="rm-team-mid">
                      <div className="rm-team-name">{m.product_name}</div>
                      <div className="rm-team-sub">{m.category} · {m.units_sold_recent} sold</div>
                    </div>
                    {m.days_of_supply != null && (
                      <ShelfTag tone={m.days_of_supply < 7 ? "red" : m.days_of_supply < 21 ? "amber" : "green"}>
                        {m.days_of_supply.toFixed(0)}d of supply left
                      </ShelfTag>
                    )}
                  </div>
                ))}
                {movers.length === 0 && <div className="rm-empty-mini">No customer purchases yet in this window — the more the app is used, the more this fills in.</div>}
              </div>
            </>
          )}

          <div className="rm-section-label">Sales trend</div>
          <div className="rm-card chart-card">
            {summary.sales_trend.length === 0 ? <div className="rm-empty-mini">No sales in this window.</div> : (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={summary.sales_trend} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(22,32,26,0.08)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#8C9188" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#8C9188" }} axisLine={false} tickLine={false} width={34} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(22,32,26,0.1)", fontSize: 12 }} formatter={(v) => ["AED " + v.toLocaleString(), "Revenue"]} />
                  <Bar dataKey="revenue" fill="#2E7D4F" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rm-section-label">Revenue mix by category</div>
          <div className="rm-card chart-card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <PieChart width={110} height={110}>
                <Pie data={summary.category_revenue_mix} dataKey="value" nameKey="name" innerRadius={30} outerRadius={50} paddingAngle={2} stroke="none">
                  {summary.category_revenue_mix.map((c) => <Cell key={c.name} fill={CATEGORY_COLORS[c.name] || "#9AA192"} />)}
                </Pie>
              </PieChart>
            <div className="rm-legend-list">
              {summary.category_revenue_mix.map((c) => (
                <div key={c.name} className="rm-legend-item">
                  <span className="rm-legend-dot" style={{ background: CATEGORY_COLORS[c.name] || "#9AA192" }} />
                  {c.name} <b>{c.value}%</b>
                </div>
              ))}
            </div>
          </div>

          <div className="rm-section-label">Food waste by category</div>
          <div className="rm-card">
            {summary.waste_by_category.map((w) => (
              <div key={w.name} className="rm-waste-row">
                <span className="rm-waste-name">{w.name}</span>
                <div className="rm-waste-track">{w.pct != null && <div className="rm-waste-fill" style={{ width: w.pct * 12 + "%" }} />}</div>
                <span className="rm-waste-pct">{w.pct != null ? w.pct + "%" : "—"}</span>
              </div>
            ))}
            {summary.waste_by_category.length === 0 && <div className="rm-empty-mini">No waste data yet — needs batches marked removed.</div>}
          </div>

          {storeMode === "enterprise" && (
            <>
              <div className="rm-section-label">Regional comparison</div>
              {summary.store_comparison.map((s) => (
                <div key={s.name} className="rm-store-row">
                  <div>
                    <div className="rm-store-row-name">{s.name} <span>{s.code}</span></div>
                  </div>
                  <div className="rm-store-row-rev">AED {(s.revenue / 1000).toFixed(1)}K</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
      </>
      )}

      {tab === "pnl" && (
        <>
          {pnlLoading && <Loading label="Computing revenue, COGS and margin from real orders…" />}
          <ErrorBanner message={pnlError} />

          {pnl && (
            <>
              <div className="rm-mini-note" style={{ marginBottom: 14 }}>
                <Receipt size={14} /> Trading P&amp;L, last {pnl.period_days} days — every figure below is computed from real orders and each product's landed cost, the level a UAE hypermarket store manager (LuLu/Carrefour-style) actually reviews. Rent and payroll aren't modeled, so this stops at gross margin.
              </div>

              {pnl.products_missing_cost > 0 && (
                <div className="rm-mini-note" style={{ marginBottom: 14 }}>
                  <AlertTriangle size={14} /> {pnl.products_missing_cost} sold product{pnl.products_missing_cost !== 1 ? "s" : ""} have no cost price on file — their margin is understated until a cost is added in Procurement → Products.
                </div>
              )}

              <div className="rm-kpi-grid">
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Net sales</div>
                  <div className="rm-kpi-value">AED <NumberTicker value={pnl.net_sales} decimals={2} /></div>
                  <div className="rm-kpi-delta good">{pnl.orders} order{pnl.orders !== 1 ? "s" : ""}</div>
                </div>
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Gross profit</div>
                  <div className="rm-kpi-value">AED <NumberTicker value={pnl.gross_profit} decimals={2} /></div>
                  <div className={"rm-kpi-delta " + (pnl.gross_profit >= 0 ? "good" : "bad")}>after COGS</div>
                </div>
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Gross margin</div>
                  <div className="rm-kpi-value"><NumberTicker value={pnl.margin_pct} decimals={1} suffix="%" /></div>
                  <div className="rm-kpi-delta good">of net sales</div>
                </div>
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Avg order value</div>
                  <div className="rm-kpi-value">AED <NumberTicker value={pnl.avg_order_value} decimals={2} /></div>
                  <div className="rm-kpi-delta good">per transaction</div>
                </div>
              </div>

              <div className="rm-section-label">Revenue → profit waterfall</div>
              <div className="rm-card">
                <div className="rm-pos-totals" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
                  <div className="rm-pos-total-row"><span>Gross sales</span><span>AED {pnl.gross_sales.toLocaleString()}</span></div>
                  <div className="rm-pos-total-row"><span>Loyalty discounts</span><span>-AED {pnl.discounts.toLocaleString()}</span></div>
                  <div className="rm-pos-total-row grand"><span>Net sales</span><span>AED {pnl.net_sales.toLocaleString()}</span></div>
                  <div className="rm-pos-total-row" style={{ marginTop: 10 }}><span>Cost of goods sold</span><span>-AED {pnl.cogs.toLocaleString()}</span></div>
                  <div className="rm-pos-total-row grand"><span>Gross profit</span><span>AED {pnl.gross_profit.toLocaleString()}</span></div>
                </div>
              </div>

              <div className="rm-section-label">Net sales vs. gross profit trend</div>
              <div className="rm-card chart-card">
                {pnl.trend.length === 0 ? <div className="rm-empty-mini">No orders in this window yet.</div> : (
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={pnl.trend} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 5" stroke="rgba(22,32,26,0.08)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "#8C9188" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#8C9188" }} axisLine={false} tickLine={false} width={34} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(22,32,26,0.1)", fontSize: 12 }} formatter={(v, n) => ["AED " + v.toLocaleString(), n === "revenue" ? "Net sales" : "Gross profit"]} />
                      <Bar dataKey="revenue" fill="#BFE0CC" radius={[6, 6, 0, 0]} />
                      <Line type="monotone" dataKey="gross_profit" stroke="#2E7D4F" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="rm-section-label">Margin by category</div>
              {pnl.by_category.map((c) => (
                <div key={c.category} className="rm-card">
                  <div className="rm-sup-top">
                    <div>
                      <div className="rm-sup-name">{c.category}</div>
                      <div className="rm-sup-cat">AED {c.revenue.toLocaleString()} revenue · AED {c.cogs.toLocaleString()} COGS</div>
                    </div>
                    <div className="rm-sup-score">
                      <div className="rm-sup-score-num">{c.margin_pct}%</div>
                      <div className="rm-sup-score-lab">margin</div>
                    </div>
                  </div>
                  <div className="rm-sup-bar-track"><div className="rm-sup-bar-fill" style={{ width: Math.max(0, Math.min(100, c.margin_pct)) + "%" }} /></div>
                </div>
              ))}
              {pnl.by_category.length === 0 && <div className="rm-empty-mini">No sales in this window yet.</div>}

              {storeMode === "enterprise" && pnl.by_store.length > 0 && (
                <>
                  <div className="rm-section-label">Margin by store</div>
                  {pnl.by_store.map((s) => (
                    <div key={s.store_id} className="rm-card">
                      <div className="rm-sup-top">
                        <div>
                          <div className="rm-sup-name">{s.store_name} <span style={{ fontWeight: 600, color: "var(--ink-soft)" }}>{s.store_code}</span></div>
                          <div className="rm-sup-cat">AED {s.revenue.toLocaleString()} revenue · AED {s.cogs.toLocaleString()} COGS</div>
                        </div>
                        <div className="rm-sup-score">
                          <div className="rm-sup-score-num">{s.margin_pct}%</div>
                          <div className="rm-sup-score-lab">margin</div>
                        </div>
                      </div>
                      <div className="rm-sup-bar-track"><div className="rm-sup-bar-fill" style={{ width: Math.max(0, Math.min(100, s.margin_pct)) + "%" }} /></div>
                    </div>
                  ))}
                </>
              )}

              <div className="rm-section-label">Business position</div>
              <div className="rm-kpi-grid">
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Procurement spend</div>
                  <div className="rm-kpi-value">AED {pnl.procurement_spend.toLocaleString()}</div>
                  <div className="rm-kpi-delta good">approved/delivered POs</div>
                </div>
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Shrinkage on hand</div>
                  <div className="rm-kpi-value">AED {pnl.shrinkage_cost.toLocaleString()}</div>
                  <div className={"rm-kpi-delta " + (pnl.shrinkage_units > 0 ? "bad" : "good")}>{pnl.shrinkage_units} units written off</div>
                </div>
                <div className="rm-kpi-card">
                  <div className="rm-kpi-label">Loyalty liability</div>
                  <div className="rm-kpi-value">AED {pnl.loyalty_liability.toLocaleString()}</div>
                  <div className="rm-kpi-delta good">outstanding points, all customers</div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ScreenAdminTeam({ team, loading, error, onAdd, onRemove, storeMode, setStoreMode, stores, activeStore, setActiveStore }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const blankForm = () => ({ name: "", email: "", department: DEPTS[0], title: "", store_id: activeStore, access_level: "staff", responsibilities: [] });
  const [form, setForm] = useState(blankForm);

  function toggleResp(r) {
    setForm((f) => ({ ...f, responsibilities: f.responsibilities.includes(r) ? f.responsibilities.filter((x) => x !== r) : [...f.responsibilities, r] }));
  }
  async function submit() {
    if (!form.name.trim() || !form.email.trim() || saving) return;
    setSaving(true);
    try {
      await onAdd({ ...form });
      setForm(blankForm());
      setShowForm(false);
    } catch {
      // error is surfaced via the `error` prop from the parent; keep the form open to retry
    } finally {
      setSaving(false);
    }
  }

  const activeStoreObj = stores.find((s) => s.id === activeStore) || stores[0];

  return (
    <div className="rm-screen">
      <TopBar title="Team & Access" subtitle="Assign roles, departments & permissions" display />
      <ErrorBanner message={error} />

      <div className="rm-mode-card">
        <div className="rm-mode-label">Deployment mode</div>
        <div className="rm-seg">
          <button className={"rm-seg-btn" + (storeMode === "single" ? " active" : "")} onClick={() => setStoreMode("single")}><Store size={14} /> Single store</button>
          <button className={"rm-seg-btn" + (storeMode === "enterprise" ? " active" : "")} onClick={() => setStoreMode("enterprise")}><Building2 size={14} /> Enterprise</button>
        </div>
        {storeMode === "enterprise" && (
          <div className="rm-store-scroll">
            {stores.map((s) => (
              <button key={s.id} className={"rm-store-chip" + (s.id === activeStore ? " active" : "")} onClick={() => setActiveStore(s.id)}>
                {s.name} <span>{s.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="rm-btn-primary rm-w100" onClick={() => setShowForm((s) => !s)}>
        <UserPlus size={16} /> {showForm ? "Close form" : "Add team member"}
      </button>

      {showForm && (
        <div className="rm-card rm-add-form" style={{ marginTop: 12 }}>
          <input className="rm-input full" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rm-input full" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="rm-input full" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
            {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input className="rm-input full" placeholder="Title (e.g. Produce Lead)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="rm-input full" value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} {s.code}</option>)}
          </select>
          <div className="rm-seg small" style={{ marginBottom: 14 }}>
            {["staff", "manager", "admin"].map((l) => (
              <button key={l} className={"rm-seg-btn" + (form.access_level === l ? " active" : "")} onClick={() => setForm({ ...form, access_level: l })}>{l[0].toUpperCase() + l.slice(1)}</button>
            ))}
          </div>
          <div className="rm-resp-label">Responsibilities</div>
          <div className="rm-resp-grid">
            {RESPONSIBILITIES.map((r) => (
              <label key={r} className={"rm-resp-chip" + (form.responsibilities.includes(r) ? " active" : "")}>
                <input type="checkbox" checked={form.responsibilities.includes(r)} onChange={() => toggleResp(r)} />
                {r}
              </label>
            ))}
          </div>
          <button className="rm-btn-primary rm-w100" onClick={submit} disabled={saving} style={{ marginTop: 2 }}>{saving ? "Adding…" : "Add to team"}</button>
        </div>
      )}

      <div className="rm-section-label" style={{ marginTop: 14 }}>{team.length} team member{team.length !== 1 ? "s" : ""} · {activeStoreObj.name}</div>
      {loading && <Loading label="Loading team…" />}
      {!loading && team.map((m) => (
        <div key={m.id} className="rm-team-row">
          <div className="rm-avatar">{m.name.charAt(0)}</div>
          <div className="rm-team-mid">
            <div className="rm-team-name">{m.name}</div>
            <div className="rm-team-sub">{m.title} · {m.department}</div>
            <div className="rm-team-resp">{m.responsibilities.length} module{m.responsibilities.length !== 1 ? "s" : ""} assigned</div>
          </div>
          <ShelfTag tone={m.access_level === "admin" ? "red" : m.access_level === "manager" ? "amber" : "neutral"}>{m.access_level}</ShelfTag>
          <button className="rm-x-btn" onClick={() => onRemove(m.id)}><X size={14} /></button>
        </div>
      ))}
      {!loading && team.length === 0 && <div className="rm-empty-mini">No team members at this store yet.</div>}
    </div>
  );
}

/* ----------------------------- root app ----------------------------- */

const TOKEN_KEY = "retailmind_token";

export default function RetailMindPrototype() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showLanding, setShowLanding] = useState(true);

  const [screen, setScreen] = useState("home");
  const [storeMode, setStoreMode] = useState("single");
  const [activeStore, setActiveStore] = useState(null);
  const [stores, setStores] = useState([]);
  const [scanOpen, setScanOpen] = useState(false);

  const [team, setTeam] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [storeDataLoading, setStoreDataLoading] = useState(true); // starts true so the first render doesn't flash "all caught up" before data arrives
  const [storeDataError, setStoreDataError] = useState("");

  const isEmployee = me?.role === "employee";

  // Restore session on load if a token is stored.
  useEffect(() => {
    if (!token) { setBootLoading(false); return; }
    apiFetch("/auth/me", { token })
      .then((profile) => setMe(profile))
      .catch((err) => { if (err.status === 401) { localStorage.removeItem(TOKEN_KEY); setToken(null); } })
      .finally(() => setBootLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A 401 on any authenticated call means the token expired or was revoked.
  useEffect(() => {
    function onExpired() {
      if (!me) return;
      handleSignOut();
      setAuthError("Your session expired — please sign in again.");
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Browser Back from the sign-in card returns to the front page instead of leaving the site.
  useEffect(() => {
    const onPop = () => setShowLanding(true);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function enterLogin() {
    window.history.pushState({ rmView: "login" }, "");
    setShowLanding(false);
  }

  function leaveLogin() {
    if (window.history.state?.rmView === "login") window.history.back();
    else setShowLanding(true);
  }

  // Store list — any signed-in user can see it (staff Enterprise picker,
  // and the customer app needs it to know which store to check out at).
  useEffect(() => {
    if (!token) return;
    apiFetch("/stores", { token }).then(setStores).catch((err) => setStoreDataError(err.message));
  }, [token]);

  useEffect(() => {
    if (isEmployee && me?.store_id && !activeStore) setActiveStore(me.store_id);
  }, [isEmployee, me, activeStore]);

  const customerStoreId = me?.preferred_store_id || stores.find((s) => s.is_headquarters)?.id || stores[0]?.id || null;

  const refreshSuppliers = useCallback(() => {
    if (!token) return;
    apiFetch("/procurement/suppliers", { token }).then(setSuppliers).catch((err) => setStoreDataError(err.message));
  }, [token]);
  const refreshProducts = useCallback(() => {
    if (!token) return;
    apiFetch("/inventory/products", { token }).then(setProducts).catch((err) => setStoreDataError(err.message));
  }, [token]);

  // Suppliers & products are store-agnostic — load once per session.
  useEffect(() => {
    if (!isEmployee || !token) return;
    refreshSuppliers();
    refreshProducts();
  }, [isEmployee, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStoreScopedData = useCallback((storeId) => {
    if (!token || !storeId) return;
    setStoreDataLoading(true);
    setStoreDataError("");
    Promise.all([
      apiFetch(`/team?store_id=${storeId}`, { token }),
      apiFetch(`/alerts?store_id=${storeId}`, { token }),
      apiFetch(`/tasks?store_id=${storeId}`, { token }),
      apiFetch(`/procurement/orders?store_id=${storeId}`, { token }),
    ])
      .then(([teamRes, alertsRes, tasksRes, ordersRes]) => {
        setTeam(teamRes); setAlerts(alertsRes); setTasks(tasksRes); setOrders(ordersRes);
      })
      .catch((err) => setStoreDataError(err.message || "Failed to load store data"))
      .finally(() => setStoreDataLoading(false));
  }, [token]);

  useEffect(() => { if (activeStore) loadStoreScopedData(activeStore); }, [activeStore, loadStoreScopedData]);

  async function handleLogin(email, password) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
      localStorage.setItem(TOKEN_KEY, res.access_token);
      setToken(res.access_token);
      const profile = await apiFetch("/auth/me", { token: res.access_token });
      setMe(profile);
      setScreen("home");
    } catch (err) {
      setAuthError(err.message || "Sign in failed");
    } finally {
      setAuthLoading(false);
    }
  }

  async function refreshMe() {
    if (!token) return;
    try {
      setMe(await apiFetch("/auth/me", { token }));
    } catch {
      // transient — the next successful fetch will catch up
    }
  }

  function handleSignOut() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMe(null);
    setShowLanding(true);
    setScreen("home");
    setScanOpen(false);
    setActiveStore(null);
    setTeam([]); setAlerts([]); setTasks([]); setOrders([]); setSuppliers([]); setProducts([]); setStores([]);
  }

  async function resolveAlert(id) {
    try {
      const updated = await apiFetch(`/alerts/${id}/resolve`, { method: "PATCH", token });
      setAlerts((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setStoreDataError(err.message);
    }
  }
  async function addTeamMember(payload) {
    try {
      const created = await apiFetch("/team", { method: "POST", token, body: payload });
      setTeam((prev) => [created, ...prev]);
      setStoreDataError("");
    } catch (err) {
      setStoreDataError(err.message);
      throw err;
    }
  }
  async function removeTeamMember(id) {
    try {
      await apiFetch(`/team/${id}`, { method: "DELETE", token });
      setTeam((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      setStoreDataError(err.message);
    }
  }
  async function toggleTask(id) {
    try {
      const updated = await apiFetch(`/tasks/${id}/toggle`, { method: "PATCH", token });
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setStoreDataError(err.message);
    }
  }
  async function approveOrder(id) {
    try {
      const updated = await apiFetch(`/procurement/orders/${id}/approve`, { method: "PATCH", token, body: { decided_by: me.id } });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch (err) {
      setStoreDataError(err.message);
    }
  }
  async function rejectOrder(id) {
    try {
      const updated = await apiFetch(`/procurement/orders/${id}/reject`, { method: "PATCH", token, body: { decided_by: me.id } });
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch (err) {
      setStoreDataError(err.message);
    }
  }

  const teamById = useMemo(() => Object.fromEntries(team.map((m) => [m.id, m.name])), [team]);
  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products]);
  const assigneeName = (id) => (id ? teamById[id] || "Team member" : "Unassigned");
  const supplierName = (id) => supplierById[id] || "Unknown supplier";
  const productName = (id) => productById[id] || "item";

  const activeStoreObj = stores.find((s) => s.id === activeStore);
  const storeName = activeStoreObj ? activeStoreObj.name + " " + activeStoreObj.code : "";
  const openAlertsCount = alerts.filter((a) => a.status !== "resolved").length;
  const isAdmin = me?.access_level === "admin";
  const canApprovePurchases = isAdmin || (me?.responsibilities || []).includes("Purchase Approvals");
  const tabs = !isEmployee ? CUSTOMER_TABS : isAdmin ? ADMIN_TABS : ASSOCIATE_TABS;

  if (bootLoading) {
    return (
      <div className="rm-root rm-outer">
        <style>{CSS}</style>
        <div className="rm-login-outer"><Loading label="Restoring session…" /></div>
      </div>
    );
  }

  if (!me) {
    if (showLanding) {
      return (
        <div className="rm-root">
          <style>{CSS}</style>
          <ScreenLanding onEnter={enterLogin} />
        </div>
      );
    }
    return (
      <div className="rm-root rm-outer">
        <style>{CSS}</style>
        <div className="rm-login-outer">
          <div style={{ width: 420, maxWidth: "100%" }}>
            <button className="rm-back-link" onClick={leaveLogin}><ChevronLeft size={15} /> Back to home</button>
            <div className="rm-login-card">
              <ScreenLogin onLogin={handleLogin} loading={authLoading} error={authError} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rm-root rm-outer">
      <style>{CSS}</style>
      <div className="rm-shell">
        <aside className="rm-sidebar">
          <div className="rm-sidebar-brand">
            <div className="mark"><Leaf size={18} color="#fff" /></div>
            <div>
              <div className="rm-sidebar-brand-name rm-display">RetailMind</div>
              <div className="rm-sidebar-brand-tag">{!isEmployee ? "Customer" : (isAdmin ? "Admin console" : me.access_level + " console")}</div>
            </div>
          </div>
          <div className="rm-sidebar-section">Menu</div>
          <SidebarNav items={tabs} active={tabs.some((t) => t.id === screen) ? screen : "home"} onChange={setScreen} />
          <div className="rm-sidebar-footer">
            <div className="rm-avatar">{me.name.charAt(0)}</div>
            <div className="rm-sidebar-footer-mid">
              <div className="rm-sidebar-footer-name">{me.name}</div>
              <div className="rm-sidebar-footer-sub">{me.title || "Customer"}</div>
            </div>
            <button className="rm-sidebar-signout" onClick={handleSignOut}><LogOut size={15} /></button>
          </div>
        </aside>
        <div className="rm-main">
          <div className="rm-scroll">
          {!isEmployee && screen === "home" && (
            <ScreenCustomerHome name={me.name.split(" ")[0]} points={me.loyalty_points} token={token} onScan={() => setScanOpen(true)} onNav={setScreen} />
          )}
          {!isEmployee && screen === "list" && <ScreenCustomerList token={token} storeId={customerStoreId} onCheckedOut={refreshMe} />}
          {!isEmployee && screen === "offers" && <ScreenCustomerOffers token={token} />}
          {!isEmployee && screen === "profile" && (
            <ScreenProfile
              roleLabel="Customer" name={me.name} sub={`${loyaltyTier(me.loyalty_points)} · ${me.loyalty_points} pts`}
              isEmployee={false} isAdmin={false} me={me} token={token} stores={stores} defaultStoreId={customerStoreId}
              onSignOut={handleSignOut} onProfileUpdated={setMe}
            />
          )}

          {isEmployee && screen === "home" && (
            <ScreenEmployeeHome member={me} storeMode={storeMode} storeName={storeName} openAlertsCount={openAlertsCount} tasks={tasks} tasksLoading={storeDataLoading} onNav={setScreen} token={token} storeId={activeStore} />
          )}
          {isEmployee && screen === "cashier" && <ScreenCashier token={token} storeId={activeStore} storeName={storeName} products={products} />}
          {isEmployee && screen === "tasks" && <ScreenTasks tasks={tasks} loading={storeDataLoading} onToggle={toggleTask} />}
          {isEmployee && screen === "cctv" && (
            <ScreenCCTV token={token} storeId={activeStore} alerts={alerts} loading={storeDataLoading} onResolve={resolveAlert} storeName={storeName} assigneeName={assigneeName} />
          )}
          {isEmployee && screen === "forecast" && <ScreenForecast token={token} storeId={activeStore} />}
          {isEmployee && screen === "procurement" && (
            <ScreenProcurement
              suppliers={suppliers} products={products} orders={orders} loading={storeDataLoading}
              onApprove={approveOrder} onReject={rejectOrder} canApprove={canApprovePurchases}
              supplierName={supplierName} productName={productName}
              token={token} storeId={activeStore}
              onSuppliersChanged={refreshSuppliers} onProductsChanged={refreshProducts}
            />
          )}
          {isEmployee && screen === "assistant" && <ScreenAssistant token={token} storeId={activeStore} />}
          {isEmployee && screen === "warehouse" && <ScreenWarehouse token={token} storeId={activeStore} />}
          {isEmployee && screen === "analytics" && isAdmin && (
            <ScreenAnalytics token={token} storeMode={storeMode} activeStoreId={activeStore} activeStoreName={activeStoreObj?.name} />
          )}
          {isEmployee && screen === "team" && isAdmin && (
            <ScreenAdminTeam
              team={team} loading={storeDataLoading} error={storeDataError}
              onAdd={addTeamMember}
              onRemove={removeTeamMember}
              storeMode={storeMode}
              setStoreMode={setStoreMode}
              stores={stores}
              activeStore={activeStore}
              setActiveStore={setActiveStore}
            />
          )}
          {isEmployee && screen === "profile" && (
            <ScreenProfile
              roleLabel={isAdmin ? "Admin" : me.access_level} name={me.name} sub={me.title}
              isEmployee={true} isAdmin={isAdmin} me={me} token={token} stores={stores} storeName={storeName}
              onSignOut={handleSignOut} onProfileUpdated={setMe} onNav={setScreen}
            />
          )}
          </div>
        </div>
      </div>
      {scanOpen && <ScanResultOverlay token={token} onClose={() => setScanOpen(false)} onAdded={() => setScreen("list")} />}
    </div>
  );
}
