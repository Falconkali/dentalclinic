/**
 * Lumière Dental Studio — Central Multi-Clinic Configuration
 * 
 * Edit this single file to customize the entire clinic's branding, contact information,
 * treatments, doctor roster, pricing packages, testimonials, SEO metadata, and cloud integrations.
 * No credentials exist here — staff authentication uses genuine Supabase Auth.
 */
window.CLINIC_CONFIG = {
  identity: {
    name: "Lumière Dental Studio",
    shortName: "LUMIÈRE",
    tagline: "Smile design, refined.",
    philosophy: "Care for your smile, beautifully considered.",
    intro: "Modern dentistry, guided by kindness. Thoughtful treatment, calm spaces, and a plan that feels right for you.",
    heroProofTitle: "Care that feels personal",
    heroProofSubtitle: "For every age, every smile.",
    locationBadge: "HYDERABAD · TELANGANA"
  },

  contact: {
    phone: "+91 98765 43210",
    phoneClean: "+919876543210",
    whatsapp: "+91 98765 43210",
    whatsappClean: "919876543210",
    email: "hello@lumieredental.example",
    hours: "Mon–Sat · 9:00–19:00",
    sundayNote: "Sunday emergency by prior contact"
  },

  location: {
    street: "12 Green Avenue",
    locality: "Hyderabad",
    city: "Hyderabad",
    state: "Telangana",
    country: "IN",
    postalCode: "500081",
    fullAddress: "12 Green Avenue, Hyderabad, Telangana",
    googleMapsUrl: "https://maps.google.com/?q=12+Green+Avenue+Hyderabad",
    googleMapsEmbed: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d121815.22894576366!2d78.3615364448551!3d17.435777497237936!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bcb974794200001%3A0x6b8f36c8430b7c7b!2sHyderabad%2C%20Telangana!5e0!3m2!1sen!2sin!4v1700000000000!5m2!1sen!2sin"
  },

  services: [
    {
      id: "01",
      name: "General dentistry",
      tagline: "Prevention, check-ups & everyday care",
      duration: "30–60 min",
      description: "Routine check-ups, preventive advice and treatment for common dental concerns. Your dentist will review your history, examine your teeth and gums, and discuss any recommended care."
    },
    {
      id: "02",
      name: "Teeth whitening",
      tagline: "A brighter smile, thoughtfully achieved",
      duration: "45–90 min",
      description: "A cosmetic treatment that can lighten natural tooth shade when clinically appropriate. Assessment for sensitivity, shade discussion and a suitable professional whitening approach."
    },
    {
      id: "03",
      name: "Clear aligners",
      tagline: "Subtle, considered teeth straightening",
      duration: "Consultation",
      description: "Removable transparent trays designed to move teeth gradually. Includes bite and oral health assessment, 3D scans where appropriate, and a tailored smile plan."
    },
    {
      id: "04",
      name: "Dental implants",
      tagline: "Reliable options for missing teeth",
      duration: "Consultation",
      description: "A permanent option for replacing missing teeth using biocompatible titanium restorations. Assessment of gums, bone density, and surgical planning."
    },
    {
      id: "05",
      name: "Veneers & smile makeover",
      tagline: "Personalised cosmetic smile planning",
      duration: "Consultation",
      description: "A consultation to explore cosmetic options that improve tooth shape, symmetry, and shade with ultra-thin porcelain veneers."
    },
    {
      id: "06",
      name: "Root canal",
      tagline: "Relief-focused care to save a tooth",
      duration: "45–60 min",
      description: "Gentle treatment for infection or deep inflammation inside a tooth to alleviate pain and preserve your natural tooth structure."
    },
    {
      id: "07",
      name: "Pediatric dentistry",
      tagline: "Positive first visits for little smiles",
      duration: "30–45 min",
      description: "Preventive and restorative oral care adapted to children and their emotional comfort. Friendly introductions and parental guidance."
    },
    {
      id: "08",
      name: "Emergency care",
      tagline: "Clear next steps when you need them",
      duration: "Urgent triage",
      description: "Rapid assessment and relief for acute pain, broken teeth, sudden trauma, or facial swelling. Contact us immediately for triage guidance."
    }
  ],

  doctors: [
    {
      id: "dr-rao",
      name: "Dr. Ananya Rao",
      role: "01 / LEAD DENTIST",
      specialty: "Restorative & general dentistry",
      credentials: "BDS, MDS (Conservative Dentistry)",
      bio: "12+ years of clinical experience specializing in minimally invasive restorative care, aesthetic tooth preservation, and preventive wellness.",
      image: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=800&q=85"
    },
    {
      id: "dr-mehta",
      name: "Dr. Kabir Mehta",
      role: "02 / COSMETIC CARE",
      specialty: "Cosmetic & smile design",
      credentials: "BDS, Fellowship in Aesthetic Dentistry",
      bio: "Dedicated to natural, harmonious smile transformations using ceramic veneers, digital smile design, and clear aligner therapies.",
      image: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=800&q=85"
    },
    {
      id: "dr-nair",
      name: "Dr. Meera Nair",
      role: "03 / FAMILY DENTISTRY",
      specialty: "Family & pediatric dentistry",
      credentials: "BDS, MDS (Pediatric Dentistry)",
      bio: "Warm, empathetic care creating positive, judgment-free dental experiences for children, adolescents, and anxious adult patients.",
      image: "https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=800&q=85"
    }
  ],

  pricing: [
    {
      name: "Essential care",
      tagline: "A GOOD PLACE TO BEGIN",
      description: "For routine maintenance and peace of mind.",
      visitPrice: "₹799",
      planPrice: "₹2,199",
      features: [
        "Consultation & oral assessment",
        "Personalised care guidance",
        "Preventive recommendations"
      ]
    },
    {
      name: "Smile refresh",
      tagline: "FOR A FRESH START",
      popular: true,
      description: "A consultation-led approach to a brighter, healthier smile.",
      visitPrice: "₹2,499",
      planPrice: "₹6,499",
      features: [
        "Consultation & smile goals",
        "Suitability assessment",
        "Options and aftercare guidance"
      ]
    },
    {
      name: "Total makeover",
      tagline: "A PERSONALISED JOURNEY",
      description: "For people exploring a comprehensive plan.",
      visitPrice: "Custom",
      planPrice: "Custom",
      features: [
        "Comprehensive assessment",
        "Staged treatment options",
        "Written estimate and timeline"
      ]
    }
  ],

  testimonials: [
    {
      quote: "I felt listened to from the moment I walked in. Everything was explained without rushing, and I felt comfortable asking questions.",
      name: "Aarav S. (Sample)",
      treatment: "General dentistry · Illustrative Demo Review",
      rating: 5
    },
    {
      quote: "The team made sure I understood every option for my aligners. I appreciated being able to decide at my own pace without feeling pressured.",
      name: "Priyanka M. (Sample)",
      treatment: "Clear aligners · Illustrative Demo Review",
      rating: 5
    },
    {
      quote: "The visit was friendly, gentle, and calm. We left with practical oral health advice we could actually follow at home.",
      name: "Kavya & Vivaan I. (Sample)",
      treatment: "Family dentistry · Illustrative Demo Review",
      rating: 5
    }
  ],

  disclaimer: {
    notice: "Demonstration System: All doctor credentials, pricing estimates, and reviews are illustrative demo placeholders. Replace with verified, clinic-approved details before commercial deployment.",
    isDemoData: true
  },

  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    youtube: "https://youtube.com/"
  },

  seo: {
    title: "Lumière Dental Studio — Smile design, refined.",
    description: "Modern, thoughtful dentistry for confident smiles. Book a consultation with Lumière Dental Studio.",
    siteUrl: "http://localhost:3000"
  },

  integrations: {
    supabaseUrl: "https://nczxzztlwveocdxphsmk.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jenh6enRsd3Zlb2NkeHBoc21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyMjkxNzksImV4cCI6MjEwNzgwNTE3OX0.pH3KPev53H1f6PGpyab_CiP5Q-6Dw0FXkphTAJpvK2M",
    submitEndpoint: "https://nczxzztlwveocdxphsmk.supabase.co/functions/v1/submit-lead-rate-limit",
    newsletterEndpoint: "https://nczxzztlwveocdxphsmk.supabase.co/functions/v1/subscribe-newsletter"
  }
};

// Convenience flat accessors for backward-compatibility across scripts
(function() {
  const cfg = window.CLINIC_CONFIG;
  if (!cfg) return;
  cfg.name = cfg.identity.name;
  cfg.shortName = cfg.identity.shortName;
  cfg.tagline = cfg.identity.tagline;
  cfg.phone = cfg.contact.phone;
  cfg.phoneClean = cfg.contact.phoneClean;
  cfg.whatsapp = cfg.contact.whatsapp;
  cfg.whatsappClean = cfg.contact.whatsappClean;
  cfg.email = cfg.contact.email;
  cfg.hours = cfg.contact.hours;
  cfg.address = cfg.location.fullAddress;
  cfg.googleMapsUrl = cfg.location.googleMapsUrl;
  cfg.googleMapsEmbed = cfg.location.googleMapsEmbed;
  cfg.supabaseUrl = cfg.integrations.supabaseUrl;
  cfg.supabaseAnonKey = cfg.integrations.supabaseAnonKey;
  cfg.submitEndpoint = cfg.integrations.submitEndpoint;
  cfg.newsletterEndpoint = cfg.integrations.newsletterEndpoint;
})();
