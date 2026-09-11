import { describe, it, expect } from 'vitest';
import { formatDisplayDate, formatDuration, formatVolume, formatWeight, formatClock, getTodayString } from '../lib/formatters';

describe('formatters', () => {
  describe('formatDuration', () => {
    it('renders minutes under an hour as Nm', () => {
      expect(formatDuration(45)).toBe('45m');
      expect(formatDuration(0)).toBe('0m');
    });

    it('renders exact hours without minutes', () => {
      expect(formatDuration(60)).toBe('1h');
      expect(formatDuration(120)).toBe('2h');
    });

    it('renders mixed hours and minutes', () => {
      expect(formatDuration(75)).toBe('1h 15m');
      expect(formatDuration(125)).toBe('2h 5m');
    });
  });

  describe('formatVolume', () => {
    it('rounds and groups thousands with the unit', () => {
      expect(formatVolume(12500.4)).toBe('12,500 kg');
      expect(formatVolume(999)).toBe('999 kg');
    });

    it('honours lb', () => {
      expect(formatVolume(1000, 'lb')).toBe('1,000 lb');
    });
  });

  describe('formatWeight', () => {
    it('shows integers without decimals', () => {
      expect(formatWeight(80)).toBe('80 kg');
    });

    it('keeps one decimal for fractional plates', () => {
      expect(formatWeight(82.5)).toBe('82.5 kg');
    });

    it('renders zero/negative weight as bodyweight', () => {
      expect(formatWeight(0)).toBe('Bodyweight');
      expect(formatWeight(-5)).toBe('Bodyweight');
    });
  });

  describe('formatClock', () => {
    it('formats seconds as m:ss', () => {
      expect(formatClock(95)).toBe('1:35');
      expect(formatClock(60)).toBe('1:00');
      expect(formatClock(9)).toBe('0:09');
    });

    it('never goes negative', () => {
      expect(formatClock(-3)).toBe('0:00');
    });
  });

  describe('formatDisplayDate', () => {
    it('returns the input for unparseable strings', () => {
      expect(formatDisplayDate('')).toBe('');
      expect(formatDisplayDate('not-a-date')).toBe('not-a-date');
    });

    it('returns Today for the current date', () => {
      expect(formatDisplayDate(getTodayString())).toBe('Today');
    });

    it('returns Yesterday for the previous date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      expect(formatDisplayDate(key)).toBe('Yesterday');
    });
  });
});
