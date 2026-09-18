'use client';
import { useParams } from 'next/navigation';
import Link from '@/components/static-link';
import { useState } from 'react';
import {
  ArrowRight,
  Box,
  Calculator,
  Check,
  CircleCheck,
  Headphones,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  Radar,
  Route,
  Scale,
  Send,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { Footer, Header } from '../page';

const pages = {
  services: {
    eyebrow: 'END-TO-END LOGISTICS',
    title: 'Services built for',
    accent: 'every delivery stage.',
    copy: 'From first-mile pickup to final-mile intelligence, run your entire shipping operation through one dependable partner.',
    items: [
      'Nationwide express delivery',
      'COD & prepaid shipping',
      'Warehousing and fulfillment',
      'Returns and NDR management',
    ],
  },
  'rate-calculator': {
    eyebrow: 'INSTANT RATE ENGINE',
    title: 'Know your shipping cost',
    accent: 'before you commit.',
    copy: 'Compare service options and estimate charges using shipment weight, dimensions and destination—without hidden surprises.',
    items: [
      'Live zone-based pricing',
      'Volumetric weight checks',
      'COD fee estimates',
      'Service-level comparison',
    ],
  },
  'track-shipment': {
    eyebrow: 'LIVE SHIPMENT VISIBILITY',
    title: 'Follow every parcel,',
    accent: 'every step of the way.',
    copy: 'Get clear delivery milestones, proactive exception updates and one reliable view from pickup to doorstep.',
    items: [
      'Real-time milestones',
      'Delivery exception alerts',
      'Estimated delivery dates',
      'Proof of delivery',
    ],
  },
  contact: {
    eyebrow: 'SHIP WITH CONFIDENCE',
    title: 'A logistics team that',
    accent: 'actually responds.',
    copy: 'Talk directly with our team about lanes, volumes, integrations or a delivery challenge you need solved.',
    items: [
      'Fast onboarding support',
      'Dedicated operations desk',
      'Integration assistance',
      'Performance reviews',
    ],
  },
} as const;

function ServicesScene() {
  return (
    <div className="scene3d services-scene">
      <div className="scene-floor" />
      <div className="hub-box">
        <Box />
      </div>
      <div className="service-node n1">
        <Truck />
      </div>
      <div className="service-node n2">
        <PackageCheck />
      </div>
      <div className="service-node n3">
        <ShieldCheck />
      </div>
      <div className="service-node n4">
        <Route />
      </div>
      <span className="orbit o1" />
      <span className="orbit o2" />
      <span className="moving-dot d1" />
      <span className="moving-dot d2" />
    </div>
  );
}
function RateScene() {
  return (
    <div className="scene3d rate-scene">
      <div className="rate-machine">
        <Scale />
        <span>RATE ENGINE</span>
        <b>₹ 128.40</b>
        <small>Delhi → Bengaluru</small>
      </div>
      <div className="calc-key k1">2.4 kg</div>
      <div className="calc-key k2">Zone C</div>
      <div className="calc-key k3">Express</div>
      <div className="rate-ring r1" />
      <div className="rate-ring r2" />
      <Calculator className="float-calc" />
    </div>
  );
}
function TrackScene() {
  return (
    <div className="scene3d track-scene">
      <div className="track-map">
        <span className="track-path" />
        <i className="pin p-a">
          <MapPin />
        </i>
        <i className="pin p-b">
          <MapPin />
        </i>
        <i className="pin p-c">
          <MapPin />
        </i>
        <div className="parcel-run">
          <Box />
        </div>
      </div>
      <div className="track-status">
        <Radar />
        <span>
          <small>IN TRANSIT</small>
          <b>Arriving tomorrow</b>
        </span>
      </div>
    </div>
  );
}
function ContactScene() {
  return (
    <div className="scene3d contact-scene">
      <div className="contact-core">
        <Headphones />
      </div>
      <span className="contact-wave cw1" />
      <span className="contact-wave cw2" />
      <span className="contact-wave cw3" />
      <div className="contact-chip cc1">
        <Phone />
        Call
      </div>
      <div className="contact-chip cc2">
        <Mail />
        Email
      </div>
      <div className="contact-chip cc3">
        <Send />
        Message
      </div>
    </div>
  );
}
function Scene({ slug }: { slug: string }) {
  if (slug === 'rate-calculator') return <RateScene />;
  if (slug === 'track-shipment') return <TrackScene />;
  if (slug === 'contact') return <ContactScene />;
  return <ServicesScene />;
}

function WorkingRateCalculator() {
  const [form, setForm] = useState({
    pickup: '',
    delivery: '',
    weight: '0.5',
    length: '20',
    width: '15',
    height: '10',
    service: 'standard',
    payment: 'prepaid',
    value: '1000',
  });
  const [result, setResult] = useState<null | {
    chargeable: number;
    freight: number;
    cod: number;
    fuel: number;
    gst: number;
    total: number;
    zone: string;
    days: string;
  }>(null);
  const field = (key: keyof typeof form, value: string) =>
    setForm({ ...form, [key]: value });
  function calculate(e: React.FormEvent) {
    e.preventDefault();
    const actual = Math.max(0.1, Number(form.weight) || 0);
    const volumetric =
      ((Number(form.length) || 0) *
        (Number(form.width) || 0) *
        (Number(form.height) || 0)) /
      5000;
    const chargeable = Math.max(actual, volumetric);
    const sameRegion = form.pickup[0] === form.delivery[0];
    const zone = sameRegion ? 'Regional' : 'National';
    const base = sameRegion ? 42 : 64;
    const multiplier = form.service === 'express' ? 1.35 : 1;
    const freight =
      (base +
        Math.max(0, chargeable - 0.5) *
          (form.service === 'express' ? 38 : 25)) *
      multiplier;
    const cod =
      form.payment === 'cod'
        ? Math.max(35, (Number(form.value) || 0) * 0.018)
        : 0;
    const fuel = freight * 0.08;
    const gst = (freight + cod + fuel) * 0.18;
    setResult({
      chargeable,
      freight,
      cod,
      fuel,
      gst,
      total: freight + cod + fuel + gst,
      zone,
      days:
        form.service === 'express' ? '1–3 business days' : '3–6 business days',
    });
  }
  return (
    <section className="calculator-section">
      <div className="calculator-shell">
        <form className="rate-form" onSubmit={calculate}>
          <div className="calc-title">
            <span>ROUTE & PARCEL DETAILS</span>
            <h2>Build your estimate.</h2>
            <p>
              Enter shipment details to calculate an indicative shipping rate.
            </p>
          </div>
          <div className="form-grid">
            <label>
              Pickup PIN code
              <input
                required
                pattern="[0-9]{6}"
                maxLength={6}
                value={form.pickup}
                onChange={(e) => field('pickup', e.target.value)}
                placeholder="110001"
              />
            </label>
            <label>
              Delivery PIN code
              <input
                required
                pattern="[0-9]{6}"
                maxLength={6}
                value={form.delivery}
                onChange={(e) => field('delivery', e.target.value)}
                placeholder="560001"
              />
            </label>
            <label>
              Actual weight (kg)
              <input
                required
                type="number"
                min="0.1"
                step="0.1"
                value={form.weight}
                onChange={(e) => field('weight', e.target.value)}
              />
            </label>
            <label>
              Shipment value (₹)
              <input
                required
                type="number"
                min="0"
                value={form.value}
                onChange={(e) => field('value', e.target.value)}
              />
            </label>
            <fieldset>
              <legend>Dimensions in cm</legend>
              <div className="dimensions">
                <input
                  aria-label="Length"
                  type="number"
                  min="1"
                  value={form.length}
                  onChange={(e) => field('length', e.target.value)}
                  placeholder="L"
                />
                <span>×</span>
                <input
                  aria-label="Width"
                  type="number"
                  min="1"
                  value={form.width}
                  onChange={(e) => field('width', e.target.value)}
                  placeholder="W"
                />
                <span>×</span>
                <input
                  aria-label="Height"
                  type="number"
                  min="1"
                  value={form.height}
                  onChange={(e) => field('height', e.target.value)}
                  placeholder="H"
                />
              </div>
            </fieldset>
            <label>
              Service preference
              <select
                value={form.service}
                onChange={(e) => field('service', e.target.value)}
              >
                <option value="standard">Standard</option>
                <option value="express">Express</option>
              </select>
            </label>
            <label>
              Payment mode
              <select
                value={form.payment}
                onChange={(e) => field('payment', e.target.value)}
              >
                <option value="prepaid">Prepaid</option>
                <option value="cod">Cash on delivery</option>
              </select>
            </label>
          </div>
          <button className="calculate-btn" type="submit">
            Calculate estimated rate <ArrowRight />
          </button>
        </form>
        <aside className={result ? 'rate-result has-result' : 'rate-result'}>
          {result ? (
            <>
              <span className="result-label">ESTIMATED TOTAL</span>
              <strong>₹{result.total.toFixed(2)}</strong>
              <small>
                {result.zone} · {result.days}
              </small>
              <div className="result-breakdown">
                <p>
                  <span>Chargeable weight</span>
                  <b>{result.chargeable.toFixed(2)} kg</b>
                </p>
                <p>
                  <span>Base freight</span>
                  <b>₹{result.freight.toFixed(2)}</b>
                </p>
                <p>
                  <span>Fuel surcharge</span>
                  <b>₹{result.fuel.toFixed(2)}</b>
                </p>
                <p>
                  <span>COD fee</span>
                  <b>₹{result.cod.toFixed(2)}</b>
                </p>
                <p>
                  <span>GST (18%)</span>
                  <b>₹{result.gst.toFixed(2)}</b>
                </p>
              </div>
              <p className="estimate-note">
                Indicative rate only. Final price may vary by exact
                serviceability, parcel contents and carrier selection.
              </p>
            </>
          ) : (
            <>
              <Calculator />
              <h3>Your estimate will appear here.</h3>
              <p>
                We compare actual and volumetric weight, then apply route,
                service and payment charges.
              </p>
              <ul>
                <li>
                  <Check />
                  6-digit PIN validation
                </li>
                <li>
                  <Check />
                  Volumetric weight included
                </li>
                <li>
                  <Check />
                  COD and GST breakdown
                </li>
              </ul>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

export default function InnerPage() {
  const { slug } = useParams<{ slug: string }>();
  const key = (slug in pages ? slug : 'services') as keyof typeof pages;
  const p = pages[key];
  return (
    <main>
      <Header />
      <section className="inner-hero product-page">
        <div className="inner-grid">
          <div>
            <span className="inner-eyebrow">{p.eyebrow}</span>
            <h1>
              {p.title}
              <br />
              <em>{p.accent}</em>
            </h1>
            <p>{p.copy}</p>
            <Link
              href={
                key === 'contact'
                  ? 'mailto:bilalsayyed1235@gmail.com'
                  : '/contact'
              }
              className="btn-primary"
            >
              {key === 'contact' ? 'Email our team' : 'Talk to our team'}{' '}
              <ArrowRight />
            </Link>
          </div>
          <Scene slug={key} />
        </div>
      </section>
      {key === 'rate-calculator' && <WorkingRateCalculator />}
      <section className="page-detail">
        <div className="detail-heading">
          <span>WHAT YOU GET</span>
          <h2>
            Built around real
            <br />
            shipping work.
          </h2>
          <p>
            Clear workflows, reliable infrastructure and support that keeps your
            operation moving.
          </p>
        </div>
        <div className="inner-cards">
          {p.items.map((x, i) => (
            <article key={x}>
              <span>0{i + 1}</span>
              <CircleCheck />
              <h2>{x}</h2>
              <p>
                Purpose-built tools and hands-on operational support, designed
                to perform at everyday and peak volumes.
              </p>
              <div>
                <Check />
                Included with ShipSy
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="process-strip">
        <div>
          <small>01</small>
          <b>Connect</b>
          <span>Share your shipment flow</span>
        </div>
        <i />
        <div>
          <small>02</small>
          <b>Configure</b>
          <span>Choose rules and services</span>
        </div>
        <i />
        <div>
          <small>03</small>
          <b>Move</b>
          <span>Launch with live visibility</span>
        </div>
      </section>
      <section className="inner-cta">
        <h2>Ready to move with clarity?</h2>
        <Link href="/contact" className="btn-dark">
          Contact ShipSy <ArrowRight />
        </Link>
      </section>
      <Footer />
    </main>
  );
}
