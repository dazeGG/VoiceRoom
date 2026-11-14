import { useState } from 'react';
import { Button } from '../../ui/index.tsx';

export interface CallOriginFilters {
  clientId?: string;
  ipKey?: string;
}

export function CallFilters({
  filters,
  onChange
}: {
  filters: CallOriginFilters;
  onChange: (filters: CallOriginFilters) => void;
}) {
  const [clientId, setClientId] = useState(filters.clientId ?? '');
  const [ipKey, setIpKey] = useState(filters.ipKey ?? '');
  return (
    <form
      className="call-filters"
      aria-label="Фильтры участников звонков"
      onSubmit={(event) => {
        event.preventDefault();
        const client = clientId.trim().toLowerCase();
        const address = ipKey.trim().toLowerCase();
        onChange({ ...(client ? { clientId: client } : {}), ...(address ? { ipKey: address } : {}) });
      }}
    >
      <label>
        ID браузера / приложения
        <input
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          maxLength={36}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label>
        Ключ IP
        <input
          value={ipKey}
          onChange={(event) => setIpKey(event.target.value)}
          placeholder="16 символов ключа адреса"
          pattern="[0-9a-fA-F]{16}"
          maxLength={16}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <Button type="submit">Применить</Button>
      {clientId || ipKey || filters.clientId || filters.ipKey ? (
        <Button
          variant="ghost"
          onClick={() => {
            setClientId('');
            setIpKey('');
            onChange({});
          }}
        >
          Сбросить фильтры
        </Button>
      ) : null}
      <p className="ui-footnote">
        Полные ID можно скопировать у участника звонка. Оба фильтра относятся к одному участнику.
      </p>
    </form>
  );
}
