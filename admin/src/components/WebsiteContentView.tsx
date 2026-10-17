import { useState } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { ServiceItem, Doctor, PricingPlan, Testimonial, GalleryCase, FaqItem, BlogPost, SiteSettings } from '../types';
import { FileText, Plus, Edit2, Trash2, Eye, EyeOff, CheckCircle2, Search, Sparkles, AlertCircle, X, ExternalLink, Image as ImageIcon } from 'lucide-react';

interface WebsiteContentViewProps {
  supabase: SupabaseClient;
  services: ServiceItem[];
  doctors: Doctor[];
  pricingPlans: PricingPlan[];
  testimonials: Testimonial[];
  galleryCases: GalleryCase[];
  faqs: FaqItem[];
  blogPosts: BlogPost[];
  settings: SiteSettings | null;
  onRefresh: () => void;
  initialTab?: 'services' | 'doctors' | 'pricing' | 'testimonials' | 'gallery' | 'faqs' | 'blog' | 'settings';
}

export default function WebsiteContentView({
  supabase,
  services,
  doctors,
  pricingPlans,
  testimonials,
  galleryCases,
  faqs,
  blogPosts,
  settings,
  onRefresh,
  initialTab = 'services'
}: WebsiteContentViewProps) {
  const [activeTab, setActiveTab] = useState<'services' | 'doctors' | 'pricing' | 'testimonials' | 'gallery' | 'faqs' | 'blog' | 'settings'>(initialTab);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [err, setErr] = useState('');

  // Modals for editing / creating
  const [editType, setEditType] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [isNew, setIsNew] = useState(false);

  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }

  // Publish / Unpublish Toggle
  async function togglePublish(table: string, id: string, current: boolean) {
    try {
      const { error } = await supabase.from(table).update({ is_published: !current }).eq('id', id);
      if (error) throw error;
      toast(`Content ${!current ? 'published to website' : 'saved to drafts'}.`);
      onRefresh();
    } catch (ex: any) {
      alert(ex?.message || 'Failed to update publication status.');
    }
  }

  // Delete Item
  async function handleDelete(table: string, id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This will remove it from the live website.`)) return;
    try {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      toast(`"${name}" removed successfully.`);
      onRefresh();
    } catch (ex: any) {
      alert(ex?.message || 'Failed to delete record.');
    }
  }

  // Save changes (Create or Update)
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');

    try {
      const table = editType!;
      const payload = { ...editItem };

      // Ensure JSON formatting
      if (table === 'doctors' && typeof payload.education === 'string') {
        payload.education = payload.education.split('\n').filter((s: string) => s.trim());
      }
      if (table === 'pricing_plans' && typeof payload.features === 'string') {
        payload.features = payload.features.split('\n').filter((s: string) => s.trim());
      }
      if (table === 'pricing_plans' && payload.monthly_price) {
        payload.monthly_price = Number(payload.monthly_price);
      }

      if (isNew) {
        delete payload.id;
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw error;
        toast('New content item created and saved!');
      } else {
        const id = payload.id;
        delete payload.id;
        delete payload.created_at;
        delete payload.updated_at;
        const { error } = await supabase.from(table).update(payload).eq('id', id);
        if (error) throw error;
        toast('Content updated successfully!');
      }

      setEditItem(null);
      setEditType(null);
      setIsNew(false);
      onRefresh();
    } catch (ex: any) {
      setErr(ex?.message || 'Failed to save changes.');
    } finally {
      setBusy(false);
    }
  }

  // Save Site Settings
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');

    try {
      const { error } = await supabase.from('site_settings').update({
        clinic_name: settings?.clinic_name,
        tagline: settings?.tagline,
        phone: settings?.phone,
        whatsapp: settings?.whatsapp,
        email: settings?.email,
        address: settings?.address,
        announcement_banner: settings?.announcement_banner,
        announcement_enabled: settings?.announcement_enabled,
        booking_slot_minutes: Number(settings?.booking_slot_minutes || 30)
      }).eq('id', 1);

      if (error) throw error;
      toast('Clinic settings updated and live on website!');
      onRefresh();
    } catch (ex: any) {
      setErr(ex?.message || 'Failed to update site settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content-management-section">
      {/* Toast Alert */}
      {toastMsg && <div className="admin-toast"><CheckCircle2 size={16} /> {toastMsg}</div>}

      {/* Header */}
      <div className="page-heading">
        <div>
          <span className="eyebrow">DIGITAL STUDIO PUBLISHER</span>
          <h1>Website content</h1>
          <p>Update treatments, doctor profiles, pricing, testimonials, gallery, and clinic settings in real time.</p>
        </div>
        <a 
          href="http://localhost:3000" 
          target="_blank" 
          rel="noreferrer" 
          className="secondary" 
          style={{ textDecoration: 'none' }}
        >
          View live website <ExternalLink size={14} />
        </a>
      </div>

      {/* Category Tabs */}
      <div className="content-category-tabs">
        <button className={activeTab === 'services' ? 'active' : ''} onClick={() => setActiveTab('services')}>
          Treatments ({services.length})
        </button>
        <button className={activeTab === 'doctors' ? 'active' : ''} onClick={() => setActiveTab('doctors')}>
          Dentists ({doctors.length})
        </button>
        <button className={activeTab === 'pricing' ? 'active' : ''} onClick={() => setActiveTab('pricing')}>
          Pricing Plans ({pricingPlans.length})
        </button>
        <button className={activeTab === 'testimonials' ? 'active' : ''} onClick={() => setActiveTab('testimonials')}>
          Stories ({testimonials.length})
        </button>
        <button className={activeTab === 'gallery' ? 'active' : ''} onClick={() => setActiveTab('gallery')}>
          Smile Gallery ({galleryCases.length})
        </button>
        <button className={activeTab === 'faqs' ? 'active' : ''} onClick={() => setActiveTab('faqs')}>
          FAQs ({faqs.length})
        </button>
        <button className={activeTab === 'blog' ? 'active' : ''} onClick={() => setActiveTab('blog')}>
          Articles ({blogPosts.length})
        </button>
        <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
          Clinic Details
        </button>
      </div>

      {/* Content Area by Tab */}
      <div className="panel" style={{ padding: '24px' }}>

        {/* 1. TREATMENTS & SERVICES */}
        {activeTab === 'services' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Clinical Treatments &amp; Services</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Manage descriptions, durations, and publication status.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  title: '',
                  slug: '',
                  short_description: '',
                  long_description: '',
                  duration: '30–60 min',
                  sort_order: services.length + 1,
                  is_published: true
                });
                setEditType('services');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add treatment
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Treatment Title</th>
                    <th>URL Slug</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Sort</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map(s => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.title}</b>
                        <small style={{ display: 'block', color: 'var(--muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.short_description}
                        </small>
                      </td>
                      <td><code>/{s.slug}</code></td>
                      <td>{s.duration || '—'}</td>
                      <td>
                        <button 
                          className="status-select" 
                          style={{ cursor: 'pointer', background: s.is_published ? '#e7f7ef' : '#f0f2f0', color: s.is_published ? '#26825f' : '#798581' }}
                          onClick={() => togglePublish('services', s.id, s.is_published)}
                        >
                          {s.is_published ? '● Live' : '○ Draft'}
                        </button>
                      </td>
                      <td>{s.sort_order}</td>
                      <td>
                        <div className="quick-actions">
                          <button className="icon-btn" title="Edit" onClick={() => { setEditItem({ ...s }); setEditType('services'); setIsNew(false); }}>
                            <Edit2 size={13} />
                          </button>
                          <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('services', s.id, s.title)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. DENTIST PROFILES */}
        {activeTab === 'doctors' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Clinical Team &amp; Specialists</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Verified doctor credentials, biographies, and specialties.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  name: '',
                  specialty: '',
                  credentials: '',
                  bio: '',
                  education: '',
                  photo_url: '',
                  sort_order: doctors.length + 1,
                  is_published: true
                });
                setEditType('doctors');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add doctor
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {doctors.map(d => (
                <div key={d.id} className="content-card">
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <img src={d.photo_url || 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=150'} alt={d.name} className="doctor-thumb" />
                    <div>
                      <b style={{ fontSize: '14px' }}>{d.name}</b>
                      <small style={{ display: 'block', color: 'var(--teal)', fontWeight: 600 }}>{d.specialty}</small>
                      <small style={{ display: 'block', color: 'var(--muted)', fontSize: '10px' }}>{d.credentials}</small>
                    </div>
                  </div>
                  <p style={{ fontSize: '12px', color: '#556663', lineHeight: 1.5, margin: '12px 0' }}>{d.bio}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                    <button 
                      className="status-select" 
                      style={{ cursor: 'pointer', background: d.is_published ? '#e7f7ef' : '#f0f2f0', color: d.is_published ? '#26825f' : '#798581' }}
                      onClick={() => togglePublish('doctors', d.id, d.is_published)}
                    >
                      {d.is_published ? '● Published' : '○ Draft'}
                    </button>
                    <div className="quick-actions">
                      <button className="icon-btn" title="Edit" onClick={() => {
                        setEditItem({
                          ...d,
                          education: Array.isArray(d.education) ? d.education.join('\n') : (d.education || '')
                        });
                        setEditType('doctors');
                        setIsNew(false);
                      }}>
                        <Edit2 size={13} />
                      </button>
                      <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('doctors', d.id, d.name)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. PRICING PLANS */}
        {activeTab === 'pricing' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Transparent Care Packages</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Annual membership and restorative package options.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  name: '',
                  monthly_price: 3500,
                  features: 'Comprehensive oral exam\nUltrasonic scaling\nDigital X-rays',
                  is_popular: false,
                  sort_order: pricingPlans.length + 1,
                  is_published: true
                });
                setEditType('pricing_plans');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add package
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {pricingPlans.map(p => (
                <div key={p.id} className="content-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b style={{ fontSize: '14px' }}>{p.name}</b>
                    {p.is_popular && <span style={{ background: 'var(--coral)', color: 'white', fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '12px' }}>POPULAR</span>}
                  </div>
                  <strong style={{ display: 'block', fontSize: '24px', margin: '12px 0 6px', color: 'var(--ink)' }}>
                    ₹{Number(p.monthly_price || 0).toLocaleString()} <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 400 }}>/ consultation</span>
                  </strong>
                  <ul style={{ paddingLeft: '16px', fontSize: '11px', color: '#556663', margin: '10px 0 16px', lineHeight: 1.6 }}>
                    {(Array.isArray(p.features) ? p.features : []).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                    <button 
                      className="status-select" 
                      style={{ cursor: 'pointer', background: p.is_published ? '#e7f7ef' : '#f0f2f0', color: p.is_published ? '#26825f' : '#798581' }}
                      onClick={() => togglePublish('pricing_plans', p.id, p.is_published)}
                    >
                      {p.is_published ? '● Live' : '○ Draft'}
                    </button>
                    <div className="quick-actions">
                      <button className="icon-btn" title="Edit" onClick={() => {
                        setEditItem({
                          ...p,
                          features: Array.isArray(p.features) ? p.features.join('\n') : (p.features || '')
                        });
                        setEditType('pricing_plans');
                        setIsNew(false);
                      }}>
                        <Edit2 size={13} />
                      </button>
                      <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('pricing_plans', p.id, p.name)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. STORIES & TESTIMONIALS */}
        {activeTab === 'testimonials' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Patient Stories &amp; Testimonials</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Verified feedback with patient consent.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  name: '',
                  rating: 5,
                  quote: '',
                  treatment: 'General dentistry',
                  photo_url: '',
                  is_featured: true,
                  is_published: true
                });
                setEditType('testimonials');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add testimonial
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {testimonials.map(t => (
                <div key={t.id} className="content-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>{t.name}</b>
                    <span style={{ color: '#f39c12' }}>{'★'.repeat(t.rating || 5)}</span>
                  </div>
                  <small style={{ color: 'var(--teal)', display: 'block', marginTop: '2px' }}>{t.treatment}</small>
                  <blockquote style={{ margin: '12px 0', fontSize: '12px', color: '#44524c', fontStyle: 'italic', lineHeight: 1.5 }}>
                    "{t.quote}"
                  </blockquote>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                    <button 
                      className="status-select" 
                      style={{ cursor: 'pointer', background: t.is_published ? '#e7f7ef' : '#f0f2f0', color: t.is_published ? '#26825f' : '#798581' }}
                      onClick={() => togglePublish('testimonials', t.id, t.is_published)}
                    >
                      {t.is_published ? '● Live' : '○ Draft'}
                    </button>
                    <div className="quick-actions">
                      <button className="icon-btn" title="Edit" onClick={() => { setEditItem({ ...t }); setEditType('testimonials'); setIsNew(false); }}>
                        <Edit2 size={13} />
                      </button>
                      <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('testimonials', t.id, t.name)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. SMILE GALLERY */}
        {activeTab === 'gallery' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Smile Gallery &amp; Clinical Cases</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Clinical photographic cases with verified consent.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  category: 'whitening',
                  before_url: '',
                  after_url: '',
                  caption: '',
                  sort_order: galleryCases.length + 1,
                  is_published: true
                });
                setEditType('gallery_cases');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add case
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {galleryCases.map(g => (
                <div key={g.id} className="content-card">
                  <img src={g.after_url || g.before_url} alt={g.caption} style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '8px' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 4px' }}>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--teal)' }}>{g.category}</span>
                    <button 
                      className="status-select" 
                      style={{ cursor: 'pointer', background: g.is_published ? '#e7f7ef' : '#f0f2f0', color: g.is_published ? '#26825f' : '#798581' }}
                      onClick={() => togglePublish('gallery_cases', g.id, g.is_published)}
                    >
                      {g.is_published ? 'Live' : 'Draft'}
                    </button>
                  </div>
                  <p style={{ fontSize: '11px', color: '#556663', margin: '4px 0 10px', lineHeight: 1.4 }}>{g.caption}</p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                    <button className="icon-btn" title="Edit" onClick={() => { setEditItem({ ...g }); setEditType('gallery_cases'); setIsNew(false); }}>
                      <Edit2 size={13} />
                    </button>
                    <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('gallery_cases', g.id, g.category)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6. FAQS */}
        {activeTab === 'faqs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Frequently Asked Questions</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Clear patient advice on treatment safety, costs, and preparation.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  question: '',
                  answer: '',
                  sort_order: faqs.length + 1,
                  is_published: true
                });
                setEditType('faqs');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add FAQ
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {faqs.map(f => (
                <div key={f.id} style={{ background: '#f8faf9', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e1e9e5', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px' }}>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: '13px', color: 'var(--ink)' }}>{f.question}</b>
                    <p style={{ fontSize: '12px', color: '#526662', margin: '6px 0 0', lineHeight: 1.5 }}>{f.answer}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      className="status-select" 
                      style={{ cursor: 'pointer', background: f.is_published ? '#e7f7ef' : '#f0f2f0', color: f.is_published ? '#26825f' : '#798581' }}
                      onClick={() => togglePublish('faqs', f.id, f.is_published)}
                    >
                      {f.is_published ? '● Live' : '○ Draft'}
                    </button>
                    <button className="icon-btn" title="Edit" onClick={() => { setEditItem({ ...f }); setEditType('faqs'); setIsNew(false); }}>
                      <Edit2 size={13} />
                    </button>
                    <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('faqs', f.id, f.question)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. BLOG & ARTICLES */}
        {activeTab === 'blog' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Articles &amp; Educational Guides</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Evidence-based oral health insights and patient education.</p>
              </div>
              <button className="primary" onClick={() => {
                setEditItem({
                  title: '',
                  slug: '',
                  summary: '',
                  body: '',
                  cover_image: '',
                  author_name: 'Lumière Editorial Team',
                  sort_order: blogPosts.length + 1,
                  is_published: true
                });
                setEditType('blog_posts');
                setIsNew(true);
              }}>
                <Plus size={15} /> Add article
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {blogPosts.map(b => (
                <div key={b.id} className="content-card">
                  {b.cover_image && <img src={b.cover_image} alt={b.title} style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '8px', marginBottom: '10px' }} />}
                  <b style={{ fontSize: '14px', display: 'block', lineHeight: 1.3 }}>{b.title}</b>
                  <code style={{ fontSize: '10px', color: 'var(--teal)' }}>/blog/{b.slug}</code>
                  <p style={{ fontSize: '12px', color: '#556663', margin: '8px 0', lineHeight: 1.5 }}>{b.summary}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                    <button 
                      className="status-select" 
                      style={{ cursor: 'pointer', background: b.is_published ? '#e7f7ef' : '#f0f2f0', color: b.is_published ? '#26825f' : '#798581' }}
                      onClick={() => togglePublish('blog_posts', b.id, b.is_published)}
                    >
                      {b.is_published ? '● Live' : '○ Draft'}
                    </button>
                    <div className="quick-actions">
                      <button className="icon-btn" title="Edit" onClick={() => { setEditItem({ ...b }); setEditType('blog_posts'); setIsNew(false); }}>
                        <Edit2 size={13} />
                      </button>
                      <button className="icon-btn" title="Delete" style={{ color: '#c0392b' }} onClick={() => handleDelete('blog_posts', b.id, b.title)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 8. CLINIC DETAILS & SETTINGS */}
        {activeTab === 'settings' && (
          <form onSubmit={handleSaveSettings} style={{ maxWidth: '600px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '16px' }}>Studio Brand &amp; Contact Information</h3>
            <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--muted)' }}>
              Changes made here update the website header, footer, booking details, and WhatsApp links instantly.
            </p>

            <label>Studio Name
              <input value={settings?.clinic_name || ''} onChange={e => { if (settings) settings.clinic_name = e.target.value; onRefresh(); }} />
            </label>

            <label>Tagline
              <input value={settings?.tagline || ''} onChange={e => { if (settings) settings.tagline = e.target.value; onRefresh(); }} />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>Phone Number
                <input value={settings?.phone || ''} onChange={e => { if (settings) settings.phone = e.target.value; onRefresh(); }} />
              </label>

              <label>WhatsApp Contact
                <input value={settings?.whatsapp || ''} onChange={e => { if (settings) settings.whatsapp = e.target.value; onRefresh(); }} />
              </label>
            </div>

            <label>Email Address
              <input type="email" value={settings?.email || ''} onChange={e => { if (settings) settings.email = e.target.value; onRefresh(); }} />
            </label>

            <label>Physical Address
              <input value={settings?.address || ''} onChange={e => { if (settings) settings.address = e.target.value; onRefresh(); }} />
            </label>

            <label>Announcement Banner (Optional)
              <input value={settings?.announcement_banner || ''} placeholder="e.g. Complimentary 3D Invisalign Scan Consultation This Month" onChange={e => { if (settings) settings.announcement_banner = e.target.value; onRefresh(); }} />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: '12px 0' }}>
              <input type="checkbox" checked={Boolean(settings?.announcement_enabled)} onChange={e => { if (settings) settings.announcement_enabled = e.target.checked; onRefresh(); }} />
              <span>Enable top announcement banner on live website</span>
            </label>

            <div style={{ marginTop: '20px' }}>
              <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save clinic details ↗'}</button>
            </div>
          </form>
        )}
      </div>

      {/* MODAL FOR CREATING / EDITING CONTENT */}
      {editItem && editType && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) { setEditItem(null); setEditType(null); } }}>
          <form className="drawer" onSubmit={handleSave}>
            <div className="drawer-head">
              <div>
                <span className="eyebrow">{isNew ? 'CREATE CONTENT' : 'EDIT CONTENT'}</span>
                <h2>{editType.replace('_', ' ').toUpperCase()}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => { setEditItem(null); setEditType(null); }}><X /></button>
            </div>

            {err && <div className="error-box"><AlertCircle size={15} /> {err}</div>}

            {/* Dynamic fields based on editType */}
            {editType === 'services' && (
              <>
                <label>Title *
                  <input required value={editItem.title} onChange={e => setEditItem({ ...editItem, title: e.target.value, slug: editItem.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} />
                </label>
                <label>URL Slug *
                  <input required value={editItem.slug} onChange={e => setEditItem({ ...editItem, slug: e.target.value })} />
                </label>
                <label>Short Description
                  <textarea rows={2} value={editItem.short_description || ''} onChange={e => setEditItem({ ...editItem, short_description: e.target.value })} />
                </label>
                <label>Long Description
                  <textarea rows={4} value={editItem.long_description || ''} onChange={e => setEditItem({ ...editItem, long_description: e.target.value })} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label>Duration
                    <input value={editItem.duration || ''} placeholder="e.g. 45–60 min" onChange={e => setEditItem({ ...editItem, duration: e.target.value })} />
                  </label>
                  <label>Display Order
                    <input type="number" value={editItem.sort_order || 1} onChange={e => setEditItem({ ...editItem, sort_order: Number(e.target.value) })} />
                  </label>
                </div>
              </>
            )}

            {editType === 'doctors' && (
              <>
                <label>Doctor Name *
                  <input required value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} />
                </label>
                <label>Specialty *
                  <input required value={editItem.specialty} onChange={e => setEditItem({ ...editItem, specialty: e.target.value })} />
                </label>
                <label>Credentials
                  <input value={editItem.credentials} placeholder="e.g. BDS, MDS (Prosthodontics)" onChange={e => setEditItem({ ...editItem, credentials: e.target.value })} />
                </label>
                <label>Biography
                  <textarea rows={3} value={editItem.bio} onChange={e => setEditItem({ ...editItem, bio: e.target.value })} />
                </label>
                <label>Education &amp; Fellowships (one per line)
                  <textarea rows={3} value={editItem.education || ''} placeholder="Degree - Institution" onChange={e => setEditItem({ ...editItem, education: e.target.value })} />
                </label>
                <label>Photo URL
                  <input value={editItem.photo_url || ''} placeholder="https://..." onChange={e => setEditItem({ ...editItem, photo_url: e.target.value })} />
                </label>
              </>
            )}

            {editType === 'pricing_plans' && (
              <>
                <label>Package Name *
                  <input required value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} />
                </label>
                <label>Price (₹) *
                  <input required type="number" value={editItem.monthly_price || 0} onChange={e => setEditItem({ ...editItem, monthly_price: Number(e.target.value) })} />
                </label>
                <label>Features Included (one per line) *
                  <textarea rows={5} value={editItem.features || ''} onChange={e => setEditItem({ ...editItem, features: e.target.value })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={Boolean(editItem.is_popular)} onChange={e => setEditItem({ ...editItem, is_popular: e.target.checked })} />
                  <span>Highlight as "Most Popular"</span>
                </label>
              </>
            )}

            {editType === 'testimonials' && (
              <>
                <label>Patient Name *
                  <input required value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} />
                </label>
                <label>Rating (1–5 Stars)
                  <select value={editItem.rating || 5} onChange={e => setEditItem({ ...editItem, rating: Number(e.target.value) })}>
                    <option value={5}>5 Stars ★★★★★</option>
                    <option value={4}>4 Stars ★★★★</option>
                    <option value={3}>3 Stars ★★★</option>
                  </select>
                </label>
                <label>Treatment Received
                  <input value={editItem.treatment || ''} placeholder="e.g. Clear Aligners" onChange={e => setEditItem({ ...editItem, treatment: e.target.value })} />
                </label>
                <label>Quote / Testimonial *
                  <textarea rows={4} required value={editItem.quote} onChange={e => setEditItem({ ...editItem, quote: e.target.value })} />
                </label>
              </>
            )}

            {editType === 'gallery_cases' && (
              <>
                <label>Category *
                  <select value={editItem.category} onChange={e => setEditItem({ ...editItem, category: e.target.value })}>
                    <option value="whitening">Teeth Whitening</option>
                    <option value="aligners">Clear Aligners</option>
                    <option value="veneers">Veneers</option>
                    <option value="implants">Implants</option>
                  </select>
                </label>
                <label>Image URL *
                  <input required value={editItem.after_url || ''} placeholder="https://..." onChange={e => setEditItem({ ...editItem, after_url: e.target.value, before_url: e.target.value })} />
                </label>
                <label>Caption / Clinical Note *
                  <textarea rows={2} required value={editItem.caption} onChange={e => setEditItem({ ...editItem, caption: e.target.value })} />
                </label>
              </>
            )}

            {editType === 'faqs' && (
              <>
                <label>Question *
                  <input required value={editItem.question} onChange={e => setEditItem({ ...editItem, question: e.target.value })} />
                </label>
                <label>Answer *
                  <textarea rows={4} required value={editItem.answer} onChange={e => setEditItem({ ...editItem, answer: e.target.value })} />
                </label>
              </>
            )}

            {editType === 'blog_posts' && (
              <>
                <label>Article Title *
                  <input required value={editItem.title} onChange={e => setEditItem({ ...editItem, title: e.target.value, slug: editItem.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} />
                </label>
                <label>URL Slug *
                  <input required value={editItem.slug} onChange={e => setEditItem({ ...editItem, slug: e.target.value })} />
                </label>
                <label>Summary / Excerpt
                  <textarea rows={2} value={editItem.summary} onChange={e => setEditItem({ ...editItem, summary: e.target.value })} />
                </label>
                <label>Article Body
                  <textarea rows={6} value={editItem.body} onChange={e => setEditItem({ ...editItem, body: e.target.value })} />
                </label>
                <label>Cover Image URL
                  <input value={editItem.cover_image || ''} placeholder="https://..." onChange={e => setEditItem({ ...editItem, cover_image: e.target.value })} />
                </label>
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: '14px 0' }}>
              <input type="checkbox" checked={Boolean(editItem.is_published)} onChange={e => setEditItem({ ...editItem, is_published: e.target.checked })} />
              <span>Publish immediately to live website</span>
            </label>

            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => { setEditItem(null); setEditType(null); }}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save content'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
