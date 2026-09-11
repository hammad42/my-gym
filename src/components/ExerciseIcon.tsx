import React from 'react';
import { Dumbbell, Cable, PersonStanding, Timer, HeartPulse, Activity } from 'lucide-react';
import { Exercise } from '../types';

// Subset of lucide icons used by the default exercise library. Keeping the map
// explicit means a bad icon name in the data degrades gracefully instead of
// crashing the render.
const ICON_MAP: Record<string, React.ElementType> = {
  Dumbbell,
  Cable,
  PersonStanding,
  Timer,
  HeartPulse,
  Activity
};

interface Props {
  exercise: Exercise;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-10 h-10 rounded-xl',
  lg: 'w-12 h-12 rounded-2xl'
};

const iconSizes = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6'
};

export const ExerciseIcon: React.FC<Props> = ({ exercise, size = 'md' }) => {
  const Icon = ICON_MAP[exercise.icon] || Dumbbell;
  return (
    <div
      className={`${sizeClasses[size]} flex items-center justify-center shrink-0 border`}
      style={{ backgroundColor: `${exercise.color}22`, borderColor: `${exercise.color}55` }}
      title={exercise.name}
    >
      <Icon className={`${iconSizes[size]}`} style={{ color: exercise.color }} />
    </div>
  );
};
