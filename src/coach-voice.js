export class CoachVoice{
 constructor({synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,onError=()=>{}}={}){this.synthesis=synthesis;this.Utterance=Utterance;this.onError=onError;this.enabled=true;this.volume=1;this.language='ja';}
 get available(){return !!this.synthesis&&!!this.Utterance;}
 configure({enabled=this.enabled,volume=this.volume,language=this.language}={}){this.cancel();this.enabled=enabled;this.volume=Math.max(0,Math.min(1,Number(volume)));this.language=language;}
 say(text){this.cancel();if(!this.available||!this.enabled||this.volume===0)return false;
  const utterance=new this.Utterance(text);utterance.lang=this.language==='ja'?'ja-JP':'en-US';utterance.volume=this.volume;utterance.rate=1.25;
  const voices=this.synthesis.getVoices?.()??[];utterance.voice=voices.find(v=>v.lang===utterance.lang)??voices.find(v=>v.lang.startsWith(this.language))??null;
  utterance.onerror=event=>{if(!['interrupted','canceled'].includes(event.error))this.onError('音声を再生できませんでした。音声テストと端末の音量設定を確認してください。');};this.synthesis.speak(utterance);return true;
 }
 deliver(feedback){this.cancel();return feedback.speak?this.say(feedback.text[this.language]):false;}
 prime(){return this.say(this.language==='ja'?'開始します':'Ready');}
 notify(text){if(!this.available||!this.enabled||this.volume===0)return false;
  clearTimeout(this.noticeTimer);const deadline=Date.now()+3000;
  const attempt=()=>{if(!this.enabled||this.volume===0||Date.now()>deadline)return;if(this.synthesis.speaking||this.synthesis.pending){this.noticeTimer=setTimeout(attempt,150);return;}this.noticeTimer=null;const u=new this.Utterance(text);u.lang='ja-JP';u.volume=this.volume;u.rate=1.25;u.onerror=e=>{if(!['interrupted','canceled'].includes(e.error))this.onError('音声を再生できませんでした。画面の通知を確認してください。');};this.synthesis.speak(u);};attempt();return true;
 }
 cancel(){clearTimeout(this.noticeTimer);this.noticeTimer=null;this.synthesis?.cancel();}
}
