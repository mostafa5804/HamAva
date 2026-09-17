'use client';

import { AudioLines, LoaderCircle, Pause, Play } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import type { Mode } from '@/lib/hamava/types';

type Props = {
  mode: Mode;
  onMode: (mode: Mode) => void;
  preparing: boolean;
  progress: number;
  progressLabel: string;
  disabled: boolean;
  label: string;
  action: 'translate' | 'play' | 'pause' | 'stop';
  onAction: () => void;
  onCancel: () => void;
  partialReady?: boolean;
  onPartialAction?: () => void;
};

/** The desktop card and mobile dock share the same actions and preparation state. */
export function TranslationControls(props: Props) {
  const Icon = props.action === 'play' ? Play : props.action === 'translate' ? AudioLines : Pause;
  return <div className="translation-controls">
    <Tabs dir="rtl" value={props.mode} onValueChange={value => props.onMode(value as Mode)}>
      <TabsList className="mode-tabs" aria-label="نوع ترجمه">
        <TabsTrigger value="both" disabled={props.preparing}>هر دو</TabsTrigger>
        <TabsTrigger value="subtitle" disabled={props.preparing}>زیرنویس</TabsTrigger>
        <TabsTrigger value="dub" disabled={props.preparing}>دوبله</TabsTrigger>
      </TabsList>
    </Tabs>
    {props.preparing ? <div className="preparing" aria-live="polite">
      <div><LoaderCircle className="spin" size={18}/><span>{props.progressLabel || 'شروع آماده‌سازی…'}</span><output>{Math.round(props.progress).toLocaleString('fa-IR')}٪</output></div>
      <Progress value={props.progress} aria-label="پیشرفت آماده‌سازی"/>
      <div className="preparing-actions"><button className="outline-button" onClick={props.onCancel}>توقف آماده‌سازی</button>{props.partialReady&&props.onPartialAction&&<button className="primary-button" onClick={props.onPartialAction}><Play size={18}/>پخش از بخش آماده</button>}</div>
    </div> : <button className={`primary-button ${props.action === 'stop' ? 'stop-button' : ''}`} disabled={props.disabled} onClick={props.onAction}>
      <Icon size={20}/><span>{props.label}</span>
    </button>}
  </div>;
}
