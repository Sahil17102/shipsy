'use client';
import Link from '@/components/static-link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Box,
  Calculator,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleCheck,
  Globe2,
  Menu,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  Radar,
  RotateCcw,
  Route,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Truck,
  X,
  Zap,
} from 'lucide-react';
const logos = [
  'Nua',
  'ZOUK',
  'PHOOL',
  'mCaffeine',
  'The Bear House',
  'Pothys',
  'Minimalist',
];
const CLIENT_PANEL_URL = 'https://shipsy-client-wkxv.onrender.com/';
const features = [
  {
    icon: Route,
    number: '01',
    title: 'Smart Shipping',
    copy: 'One intelligent layer to compare carriers, automate labels and route every order for speed and margin.',
    stat: '28%',
    label: 'lower shipping cost',
  },
  {
    icon: RotateCcw,
    number: '02',
    title: 'Frictionless Returns',
    copy: 'Turn returns into exchanges with branded workflows, instant checks and complete customer visibility.',
    stat: '2.4×',
    label: 'more exchanges',
  },
  {
    icon: PackageCheck,
    number: '03',
    title: 'Effortless Fulfillment',
    copy: 'Sync inventory, warehouses and delivery promises so every team works from the same live picture.',
    stat: '99.2%',
    label: 'dispatch accuracy',
  },
];
const proof = [
  { value: '50M+', label: 'shipments orchestrated' },
  { value: '29K+', label: 'pin codes connected' },
  { value: '99.9%', label: 'platform uptime' },
  { value: '4.8/5', label: 'merchant rating' },
];
function CountUp({ value }: { value: string }) {
  const [count, setCount] = useState('0');
  const [started, setStarted] = useState(false);
  return (
    <strong
      className="count-up"
      ref={(node) => {
        if (!node || started) return;
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting) return;
            setStarted(true);
            observer.disconnect();
            const match = value.match(/[\d.]+/);
            const target = Number(match?.[0] || 0);
            const decimals = (match?.[0].split('.')[1] || '').length;
            const suffix = value.replace(/[\d.]+/, '');
            const duration = 1800;
            const begin = performance.now();
            const tick = (now: number) => {
              const progress = Math.min((now - begin) / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 4);
              setCount(`${(target * eased).toFixed(decimals)}${suffix}`);
              if (progress < 1) requestAnimationFrame(tick);
              else setCount(value);
            };
            requestAnimationFrame(tick);
          },
          { threshold: 0.55 },
        );
        observer.observe(node);
      }}
    >
      {count}
    </strong>
  );
}
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="ShipSy home">
      <img src="/shipsy-logo.png" alt="ShipSy — Shipping, Simplified." />
    </Link>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-shell">
        <Brand />
        <nav className={open ? 'nav-links open' : 'nav-links'}>
          <Link href="/services">Services</Link>
          <Link href="/rate-calculator">Rate Calculator</Link>
          <Link href="/track-shipment">Track Shipment</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <div className={open ? 'nav-actions open' : 'nav-actions'}>
          <Link className="nav-cta nav-signin" href={CLIENT_PANEL_URL}>
            Sign In
          </Link>
        </div>
        <button
          className="menu"
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}
function HeroVisual() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  return (
    <div
      className="visual-wrap"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTilt({
          x: (e.clientX - r.left - r.width / 2) / 55,
          y: (e.clientY - r.top - r.height / 2) / 55,
        });
      }}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div
        className="visual-frame"
        style={{
          transform: `perspective(1400px) rotateX(${-tilt.y}deg) rotateY(${tilt.x}deg)`,
        }}
      >
        <div className="hero-visual">
          <img
            src="/shipsy-3d-logistics-v2.png"
            alt="3D intelligent logistics network with parcels and route signals"
          />
          <svg className="wave-layer" viewBox="0 0 700 470" aria-hidden="true">
            <path
              className="wave wave-a"
              d="M95 315 C190 225 250 350 350 255 S535 195 620 275"
            />
            <path
              className="wave wave-b"
              d="M120 350 C220 280 300 390 395 305 S545 260 635 310"
            />
            <path
              className="wave wave-c"
              d="M170 385 C255 330 325 420 420 350 S555 325 625 352"
            />
          </svg>
          <div className="radar-wave rw1" />
          <div className="radar-wave rw2" />
          <div className="radar-wave rw3" />
          <span className="signal s1" />
          <span className="signal s2" />
          <span className="signal s3" />
          <span className="route-particle rp1" />
          <span className="route-particle rp2" />
          <span className="route-particle rp3" />
          <div className="package-lift" aria-hidden="true">
            <Box />
          </div>
          <div className="float-card card-one">
            <span className="live-dot" /> Live network <b>99.9%</b>
          </div>
          <div className="float-card card-two">
            <CircleCheck size={16} /> 1,284 orders routed
          </div>
        </div>
      </div>
    </div>
  );
}
function RtoSuite() {
  const cards = [
    {
      type: 'risk',
      icon: ShieldAlert,
      title: 'Predict risky orders before dispatch',
      copy: 'Our decision engine checks order intent, address signals and buying patterns to sort every COD order into clear risk bands.',
      cta: 'Explore risk intelligence',
    },
    {
      type: 'verify',
      icon: MessageCircle,
      title: 'Verify COD orders automatically',
      copy: 'Confirm intent and validate delivery details through branded WhatsApp journeys before a label is ever created.',
      cta: 'See smart verification',
    },
    {
      type: 'recover',
      icon: RefreshCw,
      title: 'Recover failed deliveries faster',
      copy: 'Trigger timely WhatsApp nudges, capture customer responses and schedule the right reattempt without manual chasing.',
      cta: 'Improve NDR recovery',
    },
  ];
  return (
    <section className="rto-section">
      <div className="rto-head reveal">
        <div>
          <span>RTO INTELLIGENCE SUITE</span>
          <h2>
            Stop returns before
            <br />
            they start.
          </h2>
        </div>
        <p>
          COD orders do not have to become margin leaks. Shipsy turns scattered
          signals into confident actions—before and after dispatch.
        </p>
      </div>
      <div className="rto-grid">
        {cards.map(({ type, icon: Icon, ...card }, i) => (
          <article className="rto-card reveal" key={type}>
            <div className={`rto-visual ${type}`}>
              {type === 'risk' && (
                <>
                  <div className="scan-line" />
                  <div className="order-stack">
                    <span>ORDER #4821</span>
                    <b>₹2,480 · COD</b>
                    <small>New customer · address mismatch</small>
                  </div>
                  <div className="risk-badge">
                    <TriangleAlert /> HIGH RISK
                  </div>
                  <div className="risk-score">
                    <small>Risk score</small>
                    <b>86</b>
                  </div>
                </>
              )}
              {type === 'verify' && (
                <>
                  <div className="phone-ui">
                    <div>
                      <MessageCircle /> ShipSy Verify
                    </div>
                    <p>Please confirm your ₹1,640 COD order.</p>
                    <button>
                      <BadgeCheck /> Confirm order
                    </button>
                    <button className="secondary">Update address</button>
                  </div>
                  <span className="verified-pop">
                    <BadgeCheck /> Verified
                  </span>
                </>
              )}
              {type === 'recover' && (
                <>
                  <div className="recovery-path">
                    <span className="step done">
                      <Check />
                    </span>
                    <i />
                    <span className="step active">
                      <MessageCircle />
                    </span>
                    <i />
                    <span className="step">
                      <RefreshCw />
                    </span>
                  </div>
                  <div className="ndr-card">
                    <small>DELIVERY EXCEPTION</small>
                    <b>Customer requested tomorrow</b>
                    <span>Reattempt scheduled · 10:00–13:00</span>
                  </div>
                  <div className="success-ring">
                    +38%<small>recovered</small>
                  </div>
                </>
              )}
            </div>
            <div className="rto-copy">
              <span>0{i + 1}</span>
              <Icon />
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
              <Link href="/solutions">
                {card.cta} <ArrowRight />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
function Reviews() {
  const reviews = [
    {
      quote:
        'ShipSy gave our operations team one clear system. Dispatch is faster, exceptions are visible and customers receive updates without manual follow-up.',
      tag: 'SHIPPING + AUTOMATION',
      name: 'Nuzhat Enterprises',
      role: 'Commerce operations',
      mark: 'NE',
    },
    {
      quote:
        'The onboarding was direct and practical. We moved our regular lanes without interrupting daily order processing.',
      tag: 'EXPRESS DELIVERY',
      name: 'Aarav Retail',
      role: 'D2C lifestyle brand',
      mark: 'AR',
    },
    {
      quote:
        'Address checks and COD confirmation have made failed delivery management far more predictable for our team.',
      tag: 'COD VERIFICATION',
      name: 'Urban Cart',
      role: 'Online marketplace',
      mark: 'UC',
    },
    {
      quote:
        'Instead of checking multiple courier portals, our team now works from one accurate shipment view.',
      tag: 'LIVE TRACKING',
      name: 'Northline Goods',
      role: 'Consumer products',
      mark: 'NG',
    },
  ];
  return (
    <section className="reviews-section">
      <div className="reviews-head reveal">
        <span>CUSTOMER PROOF</span>
        <h2>
          Trusted where it
          <br />
          matters most.
        </h2>
        <p>
          Practical outcomes from commerce teams using ShipSy to move orders
          with less effort and more control.
        </p>
      </div>
      <div className="reviews-layout">
        <article className="review-feature reveal">
          <div className="quote-symbol">“</div>
          <blockquote>
            ShipSy replaced scattered courier decisions with one dependable
            workflow. We now catch delivery risk earlier, keep customers
            informed and spend far less time on manual coordination.
          </blockquote>
          <div className="impact-box">
            <span>IMPACT</span>
            <div>
              <strong>41%</strong>
              <small>fewer delivery exceptions</small>
            </div>
            <div>
              <strong>96%</strong>
              <small>on-time dispatch</small>
            </div>
          </div>
          <div className="review-person">
            <i>NE</i>
            <span>
              <b>Nuzhat Enterprises</b>
              <small>Operations team · Uttar Pradesh</small>
            </span>
          </div>
        </article>
        <div className="review-grid">
          {reviews.slice(1).map((r, i) => (
            <article className="review-card reveal" key={r.name}>
              <div className="stars">★★★★★</div>
              <p>“{r.quote}”</p>
              <span className="review-tag">{r.tag}</span>
              <div className="review-person">
                <i>{r.mark}</i>
                <span>
                  <b>{r.name}</b>
                  <small>{r.role}</small>
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="review-marquee">
        <div>
          {[...reviews, ...reviews].map((r, i) => (
            <span key={`${r.name}-${i}`}>
              <b>{r.mark}</b> “{r.quote}”
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
function ServiceShowcase() {
  const items = [
    {
      icon: Truck,
      no: '01',
      title: 'Doorstep shipping',
      copy: 'Documents, parcels and commerce orders picked up through one dependable workflow.',
      link: '/services',
      action: 'Explore services',
    },
    {
      icon: Radar,
      no: '02',
      title: 'Live journey',
      copy: 'See every important shipment stage from manifest to final delivery.',
      link: '/track-shipment',
      action: 'Track a shipment',
    },
    {
      icon: Calculator,
      no: '03',
      title: 'Clear estimate',
      copy: 'Calculate indicative charges using route, weight, dimensions and speed.',
      link: '/rate-calculator',
      action: 'Check a rate',
    },
    {
      icon: ChartNoAxesCombined,
      no: '04',
      title: 'Business dispatch',
      copy: 'Structured pickup and shipping support built for recurring order volumes.',
      link: '/contact',
      action: 'Plan dispatch',
    },
  ];
  return (
    <section className="service-showcase">
      <div className="showcase-intro reveal">
        <span>THE SHIPSY DESK</span>
        <h2>
          One partner.
          <br />
          Four ways to
          <br />
          <em>move better.</em>
        </h2>
        <p>
          Fast when a shipment is urgent. Predictable when margins matter.
          Flexible when your business grows.
        </p>
        <Link href="/services">
          See all capabilities <ArrowRight />
        </Link>
      </div>
      <div className="showcase-cards">
        {items.map(({ icon: Icon, ...x }, i) => (
          <article className="showcase-card reveal" key={x.no}>
            <div className="showcase-art">
              <small>{x.no}</small>
              <div className="object-stage">
                <span className="stage-ring" />
                <span className="stage-ring second" />
                <div className="stage-object">
                  <Icon />
                </div>
                <i />
              </div>
            </div>
            <div className="showcase-copy">
              <h3>{x.title}</h3>
              <p>{x.copy}</p>
              <Link href={x.link}>
                {x.action}
                <ArrowRight />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export default function Home() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const o = new IntersectionObserver(
      (es) =>
        es.forEach(
          (e) => e.isIntersecting && e.target.classList.add('visible'),
        ),
      { threshold: 0.12 },
    );
    els.forEach((el) => o.observe(el));
    return () => o.disconnect();
  }, []);
  return (
    <main>
      <Header />
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={15} /> Built for modern commerce
            </div>
            <h1>
              Move every order
              <br />
              <span>with intelligence.</span>
            </h1>
            <p>
              One connected logistics platform to ship faster, reduce costs and
              create delivery experiences your customers remember.
            </p>
            <div className="hero-actions">
              <Link className="btn-primary" href={CLIENT_PANEL_URL}>
                Start shipping smarter <ArrowRight size={18} />
              </Link>
              <Link className="btn-ghost" href="/platform">
                <span className="play">▶</span> See how it works
              </Link>
            </div>
            <div className="mini-proof">
              <span>
                <Check />
                No setup fee
              </span>
              <span>
                <Check />
                Go live in 24 hours
              </span>
            </div>
          </div>
          <HeroVisual />
        </div>
        <div className="route-line" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="logo-section">
        <p>TRUSTED BY AMBITIOUS COMMERCE BRANDS</p>
        <div className="logo-row">
          {logos.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      </section>
      <section className="manifesto reveal">
        <div className="section-tag">THE SHIPSY DIFFERENCE</div>
        <h2>
          Logistics should feel like
          <br />
          <em>a growth engine.</em>
        </h2>
        <p>
          We connect the moving parts—orders, carriers, warehouses and
          customers—into one calm, intelligent operating system.
        </p>
      </section>
      <ServiceShowcase />
      <section className="features">
        <div className="feature-intro reveal">
          <span>ONE PLATFORM. EVERY DELIVERY MOMENT.</span>
          <h2>
            From checkout to doorstep,
            <br />
            stay one step ahead.
          </h2>
        </div>
        <div className="feature-list">
          {features.map(({ icon: Icon, ...f }) => (
            <article className="feature-row reveal" key={f.title}>
              <div className="feature-no">{f.number}</div>
              <div className="feature-icon">
                <Icon />
              </div>
              <div>
                <h3>{f.title}</h3>
                <p>{f.copy}</p>
                <Link href="/solutions">
                  Explore solution <ArrowRight size={15} />
                </Link>
              </div>
              <div className="feature-stat">
                <strong>{f.stat}</strong>
                <span>{f.label}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <RtoSuite />
      <section className="control-section">
        <div className="control-copy reveal">
          <div className="section-tag mint">CONTROL TOWER</div>
          <h2>
            See the whole network.
            <br />
            Act before it slows down.
          </h2>
          <p>
            Live signals surface delays, exceptions and cost leaks while
            automation handles the next best action.
          </p>
          <ul>
            <li>
              <Zap />
              Predict delivery risks early
            </li>
            <li>
              <ShieldCheck />
              Automate carrier allocation
            </li>
            <li>
              <ChartNoAxesCombined />
              Measure every promise
            </li>
          </ul>
          <Link className="btn-light" href="/platform">
            Explore the platform <ArrowRight size={17} />
          </Link>
        </div>
        <div className="dashboard reveal">
          <div className="dash-top">
            <span>Network overview</span>
            <b>LIVE</b>
          </div>
          <div className="map">
            <Globe2 />
            <div className="pulse p1" />
            <div className="pulse p2" />
            <div className="pulse p3" />
            <svg viewBox="0 0 500 230">
              <path d="M55 170 Q155 25 260 115 T450 48" />
              <path d="M80 55 Q210 210 430 145" />
            </svg>
          </div>
          <div className="dash-metrics">
            <div>
              <small>On-time delivery</small>
              <strong>94.8%</strong>
              <i className="up">↗ 4.2%</i>
            </div>
            <div>
              <small>Active shipments</small>
              <strong>18,420</strong>
              <i>Live</i>
            </div>
            <div>
              <small>Exceptions</small>
              <strong>0.7%</strong>
              <i className="down">↓ 18%</i>
            </div>
          </div>
        </div>
      </section>
      <section className="proof">
        <div className="proof-head reveal">
          <div>
            <span>BUILT TO SCALE</span>
            <h2>
              Serious infrastructure.
              <br />
              Simple experience.
            </h2>
          </div>
          <p>
            Ship confidently through festive peaks, flash sales and everyday
            growth.
          </p>
        </div>
        <div className="proof-grid">
          {proof.map((x) => (
            <div key={x.label}>
              <CountUp value={x.value} />
              <span>{x.label}</span>
            </div>
          ))}
        </div>
      </section>
      <Reviews />
      <section className="cta">
        <div>
          <span>READY WHEN YOU ARE</span>
          <h2>
            Make every delivery
            <br />
            your best one yet.
          </h2>
        </div>
        <Link href="/demo" className="btn-dark">
          Book your demo <ArrowRight />
        </Link>
      </section>
      <Footer />
    </main>
  );
}
export function Footer() {
  return (
    <>
      <section className="faq-section">
        <div className="faq-intro">
          <span>QUICK ANSWERS</span>
          <h2>
            A few things
            <br />
            worth knowing.
          </h2>
          <p>Need something more specific? Call or email our team directly.</p>
          <a href="tel:+917454952149">+91 74549 52149</a>
        </div>
        <div className="faq-list">
          <details>
            <summary>
              <span>What do I need to track my shipment?</span>
              <i>+</i>
            </summary>
            <p>
              Keep your AWB or order number ready. Enter it on the tracking page
              to see the latest shipment status and delivery milestones.
            </p>
          </details>
          <details>
            <summary>
              <span>Where is the ShipSy support desk?</span>
              <i>+</i>
            </summary>
            <p>
              Our business desk is based in Deoband, District Saharanpur, Uttar
              Pradesh. You can also reach the team by phone or email.
            </p>
          </details>
          <details>
            <summary>
              <span>How quickly can I start shipping?</span>
              <i>+</i>
            </summary>
            <p>
              Most businesses can complete the basic setup within 24 hours after
              account verification and carrier configuration.
            </p>
          </details>
        </div>
      </section>
      <footer>
        <div className="footer-top">
          <div className="footer-brand">
            <Brand />
            <p>
              Clear, reliable shipping support for growing businesses across
              India.
            </p>
          </div>
          <div className="footer-links">
            <div>
              <b>Services</b>
              <Link href="/solutions">Shipping solutions</Link>
              <Link href="/platform">Logistics platform</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/resources">Resources</Link>
              <Link href="/contact">Contact</Link>
            </div>
          </div>
          <address className="footer-contact">
            <a href="tel:+917454952149">+91 74549 52149</a>
            <a href="mailto:bilalsayyed1235@gmail.com">
              bilalsayyed1235@gmail.com
            </a>
            <span>NUZHAT ENTERPRISES</span>
            <span>
              Allah rakha market near muslim fund deoband,
              <br />
              Dist Saharanpur, Uttar Pradesh — 247554
            </span>
            <span>GSTIN — 09DDHPN6657R1ZE</span>
          </address>
        </div>
        <div className="footer-bottom">
          <span>© 2026 ShipSy. All rights reserved.</span>
          <span>Deoband · Uttar Pradesh · India</span>
        </div>
      </footer>
    </>
  );
}
