// src/types/resource.ts
// Types for Subsystem 2 — Resource Catalogue frontend.
// Mirror the backend types/index.ts exactly so API responses deserialise cleanly.

export type ResourceTypeId = 'SEMINAR_ROOM' | 'LAB' | 'GPU_CLUSTER' | 'EQUIPMENT';

export interface Resource {
  id:           string;
  name:         string;
  typeId:       ResourceTypeId;
  resourceType: ResourceTypeId; // alias from backend
  location:     string;
  capacity:     number;
  description:  string;
  isActive:     boolean;
  amenities:    string[];
  version:      number;
  createdAt:    string;
  updatedAt:    string;
  availabilitySummary?: AvailabilitySummary;
}

export interface AvailabilitySummary {
  date:           string;
  totalSlots:     number;
  freeSlots:      number;
  hasAvailability: boolean;
}

export type SlotStatus = 'FREE' | 'BOOKED' | 'PENDING' | 'MAINTENANCE';

export interface TimeSlot {
  startTime: string; // ISO 8601
  endTime:   string;
  status:    SlotStatus;
}

export interface AvailabilityCalendar {
  resourceId:   string;
  resourceName: string;
  date:         string;
  slots:        TimeSlot[];
  cachedAt:     string;
  fromCache:    boolean;
}

export interface ResourceType {
  id:          ResourceTypeId;
  name:        string;
  description: string;
}

export interface MaintenanceWindow {
  id:         string;
  resourceId: string;
  startTime:  string;
  endTime:    string;
  reason:     string;
  createdBy:  string;
  createdAt:  string;
}

export interface ResourceSearchFilters {
  type?:        ResourceTypeId;
  location?:    string;
  minCapacity?: number;
  date?:        string; // YYYY-MM-DD
  amenities?:   string[];
}

export const RESOURCE_TYPE_META: Record<ResourceTypeId, { label: string; icon: string; color: string; bg: string }> = {
  SEMINAR_ROOM: { label: 'Seminar Room',  icon: '🏛️', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  LAB:          { label: 'Laboratory',    icon: '🔬', color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  GPU_CLUSTER:  { label: 'GPU Cluster',   icon: '⚡', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  EQUIPMENT:    { label: 'Equipment',     icon: '🎥', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
};