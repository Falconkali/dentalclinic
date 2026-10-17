export type StaffRole = 'admin' | 'receptionist' | 'doctor';

export interface Profile {
  id: string;
  full_name: string;
  role: StaffRole;
  avatar_url?: string;
  is_active: boolean;
  email?: string;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'booked' | 'completed' | 'lost' | 'spam';
export type LeadPriority = 'low' | 'normal' | 'high';
export type LeadSource = 'booking_form' | 'contact_form' | 'whatsapp' | 'phone' | 'walk_in' | 'manual';

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  service?: string;
  plan?: string;
  preferred_date?: string;
  preferred_time?: string;
  message?: string;
  source: LeadSource;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';

export interface Appointment {
  id: string;
  lead_id?: string;
  patient_name: string;
  phone: string;
  email?: string;
  service?: string;
  doctor_id?: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes?: string;
  internal_notes?: string;
  cancel_reason?: string;
  source?: string;
  created_at: string;
  updated_at: string;
  doctor?: Doctor;
}

export type FollowUpPriority = 'low' | 'normal' | 'high' | 'urgent';
export type FollowUpStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type ContactMethod = 'phone' | 'email' | 'whatsapp' | 'in_person' | 'other';

export interface FollowUp {
  id: string;
  lead_id?: string;
  appointment_id?: string;
  title: string;
  description?: string;
  due_at: string;
  priority: FollowUpPriority;
  status: FollowUpStatus;
  contact_method: ContactMethod;
  outcome?: string;
  cancel_reason?: string;
  next_follow_up_at?: string;
  assigned_to?: string;
  created_by?: string;
  done: boolean;
  created_at: string;
  updated_at: string;
  lead?: Lead;
  assignee?: Profile;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  credentials: string;
  bio: string;
  education?: string[];
  photo_url?: string;
  sort_order: number;
  is_published: boolean;
}

export interface ServiceItem {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  long_description: string;
  duration?: string;
  recovery?: string;
  image_url?: string;
  sort_order: number;
  is_published: boolean;
}

export interface PricingPlan {
  id: string;
  name: string;
  monthly_price?: number;
  one_time_price?: number;
  features: string[];
  is_popular: boolean;
  sort_order: number;
  is_published: boolean;
}

export interface Testimonial {
  id: string;
  name: string;
  rating: number;
  quote: string;
  treatment?: string;
  photo_url?: string;
  is_featured: boolean;
  is_published: boolean;
}

export interface GalleryCase {
  id: string;
  category: string;
  before_url?: string;
  after_url?: string;
  caption: string;
  sort_order: number;
  is_published: boolean;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  is_published: boolean;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  cover_image?: string;
  author_name: string;
  author_id?: string;
  published_at?: string;
  is_published: boolean;
  sort_order: number;
}

export interface SiteSettings {
  id: number;
  clinic_name: string;
  tagline: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  map_embed_url?: string;
  opening_hours: Record<string, [string, string] | null>;
  announcement_banner?: string;
  announcement_enabled: boolean;
  booking_slot_minutes: number;
  seo_title?: string;
  seo_description?: string;
}
