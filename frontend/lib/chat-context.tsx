'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { SERVICES, ARTISTS, LOCATIONS } from './mock-data';

export interface ServiceRecommendation {
  serviceId: string;
  name: string;
  adultPrice: number;
  childPrice: number;
  durationMinutes: number;
  artistName: string;
  locationName: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
  recommendations?: ServiceRecommendation[];
}

interface ChatContextType {
  messages: ChatMessage[];
  isTyping: boolean;
  sendMessage: (text: string) => void;
  sendQuickAction: (action: string) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

let msgCounter = 0;
function nextId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

function generateAIResponse(userText: string): { text: string; recommendations?: ServiceRecommendation[] } {
  const lower = userText.toLowerCase();

  const serviceKeywords: Record<string, string> = {
    'керамик': 's1',
    'рисован': 's2',
    'акварел': 's2',
    'скетчинг': 's3',
    'лепк': 's4',
    'глин': 's4',
    'масл': 's5',
    'живопис': 's5',
  };

  for (const [keyword, serviceId] of Object.entries(serviceKeywords)) {
    if (lower.includes(keyword)) {
      const service = SERVICES.find(s => s.id === serviceId);
      if (service) {
        const artist = ARTISTS.find(a => a.id === 'a1');
        const location = LOCATIONS.find(l => l.id === 'l1');
        return {
          text: `Отличный выбор! 🎨 Вот что я могу рассказать о **${service.name}**:`,
          recommendations: [{
            serviceId: service.id,
            name: service.name,
            adultPrice: service.adultPrice,
            childPrice: service.childPrice,
            durationMinutes: service.durationMinutes,
            artistName: artist?.name ?? '',
            locationName: location?.name ?? '',
          }],
        };
      }
    }
  }

  if (lower.includes('ребёнок') || lower.includes('детск') || lower.includes('с ребёнком') || lower.includes('с ребенком') || lower.includes('дети')) {
    const familyServices = SERVICES.filter(s => s.childPrice > 0).slice(0, 3);
    return {
      text: 'Конечно! У нас есть мастер-классы, которые отлично подходят для занятий с детьми 👨‍👩‍👧‍👦 Детский тариф доступен на всех МК:',
      recommendations: familyServices.map(s => {
        const artist = ARTISTS.find(a => a.id === 'a1');
        const location = LOCATIONS.find(l => l.id === 'l1');
        return {
          serviceId: s.id,
          name: s.name,
          adultPrice: s.adultPrice,
          childPrice: s.childPrice,
          durationMinutes: s.durationMinutes,
          artistName: artist?.name ?? '',
          locationName: location?.name ?? '',
        };
      }),
    };
  }

  if (lower.includes('индивидуальн') || lower.includes('персональн') || lower.includes('частн')) {
    return {
      text: '🔒 Индивидуальное занятие — это персональный мастер-класс только для вас!\n\nСтоимость: **8 200 ₽** (базовая цена за первое посещение)\n\nВы можете выбрать любую из наших программ, и мастер будет работать только с вами. Для записи перейдите на страницу бронирования:',
      recommendations: SERVICES.slice(0, 2).map(s => {
        const artist = ARTISTS.find(a => a.id === 'a1');
        const location = LOCATIONS.find(l => l.id === 'l1');
        return {
          serviceId: s.id,
          name: s.name,
          adultPrice: s.individualPrice,
          childPrice: s.childPrice,
          durationMinutes: s.durationMinutes,
          artistName: artist?.name ?? '',
          locationName: location?.name ?? '',
        };
      }),
    };
  }

  if (lower.includes('цена') || lower.includes('стоимост') || lower.includes('сколько') || lower.includes('цен') || lower.includes('прайс')) {
    return {
      text: '💰 Вот наши цены на мастер-классы:\n\n• **Керамика** — 2 500 ₽ / 1 800 ₽ (взрослый / детский)\n• **Рисование акварелью** — 2 800 ₽ / 2 000 ₽\n• **Скетчинг** — 2 200 ₽ / 1 500 ₽\n• **Лепка из глины** — 3 000 ₽ / 2 200 ₽\n• **Живопись маслом** — 3 500 ₽ / 2 500 ₽\n\n🔒 Индивидуальное занятие — 8 200 ₽\n\nДля записи нажмите на любой МК ниже 👇',
      recommendations: SERVICES.map(s => {
        const artist = ARTISTS.find(a => a.id === 'a1');
        const location = LOCATIONS.find(l => l.id === 'l1');
        return {
          serviceId: s.id,
          name: s.name,
          adultPrice: s.adultPrice,
          childPrice: s.childPrice,
          durationMinutes: s.durationMinutes,
          artistName: artist?.name ?? '',
          locationName: location?.name ?? '',
        };
      }),
    };
  }

  if (lower.includes('где') || lower.includes('адрес') || lower.includes('локаци') || lower.includes('расположен') || lower.includes('место')) {
    return {
      text: '📍 Наши студии:\n\n• **Главный офис** — вместимость до 20 человек\n• **Филиал 1** — вместимость до 15 человек\n• **Студия на Арбате** — вместимость до 10 человек\n\nВсе локации оснащены необходимыми материалами и оборудованием. Для записи выберите МК ниже 👇',
    };
  }

  if (lower.includes('все') || lower.includes('список') || lower.includes('какие') || lower.includes('доступн') || lower.includes('есть') || lower.includes('что')) {
    return {
      text: '🎨 У нас доступные следующие мастер-классы:',
      recommendations: SERVICES.map(s => {
        const artist = ARTISTS.find(a => a.id === 'a1');
        const location = LOCATIONS.find(l => l.id === 'l1');
        return {
          serviceId: s.id,
          name: s.name,
          adultPrice: s.adultPrice,
          childPrice: s.childPrice,
          durationMinutes: s.durationMinutes,
          artistName: artist?.name ?? '',
          locationName: location?.name ?? '',
        };
      }),
    };
  }

  if (lower.includes('привет') || lower.includes('здравствуй') || lower.includes('добрый') || lower.includes('хай') || lower.includes('hello') || lower.includes('hi')) {
    return {
      text: 'Здравствуйте! 👋 Я AI-консьерж студии мастер-классов.\n\nЯ помогу вам:\n• Узнать о доступных мастер-классах\n• Подобрать занятие для себя или с ребёнком\n• Рассказать о ценах и локациях\n• Помочь записаться на занятие\n\nЧто вас интересует? 🎨',
    };
  }

  return {
    text: 'Я могу помочь вам с выбором мастер-класса! 🎨\n\nПопробуйте спросить:\n• «Какие МК доступны?»\n• «Хочу с ребёнком»\n• «Сколько стоит?»\n• «Где проходит?»\n\nИли нажмите одну из кнопок ниже 👇',
  };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'ai',
      text: 'Здравствуйте! 👋 Я AI-консьерж студии мастер-классов.\n\nЯ помогу вам подобрать занятие, расскажу о ценах и локациях. Я только рекомендую — для записи перейдите на страницу бронирования.\n\nЧем могу помочь? 🎨',
      timestamp: new Date(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((role: 'user' | 'ai', text: string, recommendations?: ServiceRecommendation[]) => {
    setMessages(prev => [...prev, {
      id: nextId(),
      role,
      text,
      recommendations,
      timestamp: new Date(),
    }]);
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;

    addMessage('user', text.trim());
    setIsTyping(true);

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    typingTimerRef.current = setTimeout(() => {
      const response = generateAIResponse(text);
      addMessage('ai', response.text, response.recommendations);
      setIsTyping(false);
    }, 1000 + Math.random() * 1000);
  }, [addMessage]);

  const sendQuickAction = useCallback((action: string) => {
    sendMessage(action);
  }, [sendMessage]);

  return (
    <ChatContext.Provider value={{ messages, isTyping, sendMessage, sendQuickAction }}>
      {children}
    </ChatContext.Provider>
  );
}