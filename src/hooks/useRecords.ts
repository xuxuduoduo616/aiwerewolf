import { useEffect, useState } from 'react';
import { GameRecord, SupabaseSession } from '../types';
import { fetchGameRecords, isSupabaseConfigured } from '../services/supabaseClient';

const LOCAL_RECORD_KEY = 'werewolf_guest_records';

export function useRecords(session: SupabaseSession | null) {
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [recordError, setRecordError] = useState('');
  const [showRecords, setShowRecords] = useState(false);

  const loadLocalRecords = () => {
    try {
      const raw = localStorage.getItem(LOCAL_RECORD_KEY);
      setRecords(raw ? JSON.parse(raw) : []);
    } catch (e) {
      setRecords([]);
    }
  };

  // When session changes (user logs in), fetch records from Supabase
  useEffect(() => {
    if (!session || !isSupabaseConfigured()) return;
    fetchGameRecords(session)
      .then(nextRecords => {
        setRecords(nextRecords);
        setRecordError('');
      })
      .catch(error => {
        setRecordError(error.message || '战绩加载失败。');
      });
  }, [session]);

  return {
    records,
    setRecords,
    recordError,
    setRecordError,
    showRecords,
    setShowRecords,
    loadLocalRecords,
  };
}
