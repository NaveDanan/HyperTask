import { useMemo, useState } from 'react';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { useTr } from '@/i18n';
import { FlowyButton, FlowyHover, FlowySvg, FlowyText, Spinner } from '@/ui';
import { useIconGroups } from './icon-groups';
import { EmojiText, SvgString } from './ViewIcon';

export interface SelectedIcon {
  ty: ViewIconTypePB;
  value: string;
}

// A built-in emoji set. Flutter uses flutter_emoji_mart's full data set (with names and skin
// tones); this port ships the common emoji per category until that data set is bundled.
const EMOJI_CATEGORIES: Array<[string, string]> = [
  ['Smileys & People', '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬👍👎👏🙌👐🤝🙏✍️💪👀🧠👶👦👧🧑👨👩🧓👴👵'],
  ['Animals & Nature', '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🐢🐍🦎🐙🦑🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦒🐪🐫🦘🐃🐂🐄🐎🐖🐏🐑🐐🦌🐕🐈🌵🎄🌲🌳🌴🌱🌿☘️🍀🍁🍂🍃🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛⭐🌟✨⚡🔥🌈☀️⛅☁️🌧️❄️☃️💧🌊'],
  ['Food & Drink', '🍏🍎🍐🍊🍋🍌🍉🍇🍓🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🌮🌯🥗🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍥🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🥛☕🍵🧃🥤🍶🍺🍻🥂🍷🥃🍸🍹'],
  ['Activities', '⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🏓🏸🏒🏑🥍🏏⛳🏹🎣🥊🥋🎽🛹⛸️🥌🎿⛷️🏂🏋️🤸⛹️🤺🏌️🏇🧘🏄🏊🚣🧗🚴🏆🥇🥈🥉🏅🎖️🎗️🎫🎟️🎪🎭🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🎻🎲♟️🎯🎳🎮🎰🧩'],
  ['Travel & Places', '🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🚚🚛🚜🛴🚲🛵🏍️🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈️🛫🛬🛩️💺🚀🛸🚁🛶⛵🚤🛥️🛳️⛴️🚢⚓⛽🚧🚦🚥🗺️🗿🗽🗼🏰🏯🏟️🎡🎢🎠⛲⛱️🏖️🏝️🏜️🌋⛰️🏔️🗻🏕️⛺🏠🏡🏘️🏚️🏗️🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛️⛪🕌🕍🛕'],
  ['Objects', '⌚📱💻⌨️🖥️🖨️🖱️💽💾💿📀📷📸📹🎥📞☎️📟📠📺📻🎙️⏱️⏲️⏰🕰️⌛⏳📡🔋🔌💡🔦🕯️🧯💸💵💴💶💷💰💳💎⚖️🧰🔧🔨⚒️🛠️⛏️🔩⚙️🧱⛓️🧲🔫💣🧨🪓🔪🗡️⚔️🛡️🚬⚰️⚱️🏺🔮📿🧿💈⚗️🔭🔬🕳️💊💉🩸🧬🦠🧫🧪🌡️🧹🧺🧻🚽🚰🚿🛁🧼🧽🧴🛎️🔑🗝️🚪🪑🛋️🛏️🧸🖼️🛍️🛒🎁🎈🎏🎀🎊🎉🎎🏮🎐🧧✉️📩📨📧💌📥📤📦🏷️📪📫📬📭📮📯📜📃📄📑🧾📊📈📉🗒️🗓️📆📅🗑️📇🗃️🗳️🗄️📋📁📂🗂️🗞️📰📓📔📒📕📗📘📙📚📖🔖🧷🔗📎🖇️📐📏🧮📌📍✂️🖊️🖋️✒️🖌️🖍️📝✏️🔍🔎🔏🔐🔒🔓'],
  ['Symbols', '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉️☸️✡️🔯🕎☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️🉑☢️☣️📴📳🈶🈚🈸🈺🈷️✴️🆚💮🉐㊙️㊗️🈴🈵🈹🈲🅰️🅱️🆎🆑🅾️🆘❌⭕🛑⛔📛🚫💯💢♨️🚷🚯🚳🚱🔞📵🚭❗❕❓❔‼️⁉️🔅🔆〽️⚠️🚸🔱⚜️🔰♻️✅🈯💹❇️✳️❎🌐💠Ⓜ️🌀💤🏧🚾♿🅿️🈳🈂️🛂🛃🛄🛅🚹🚺🚼🚻🚮🎦📶🈁🔣ℹ️🔤🔡🔠🆖🆗🆙🆒🆕🆓0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟🔢#️⃣*️⃣⏏️▶️⏸️⏯️⏹️⏺️⏭️⏮️⏩⏪⏫⏬◀️🔼🔽➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️↪️↩️⤴️⤵️🔀🔁🔂🔄🔃🎵🎶➕➖➗✖️♾️💲💱™️©️®️〰️➰➿🔚🔙🔛🔝🔜✔️☑️🔘🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷🔳🔲▪️▫️◾◽◼️◻️🟥🟧🟨🟩🟦🟪⬛⬜🟫'],
  ['Flags', '🏁🚩🎌🏴🏳️🏳️‍🌈🏴‍☠️🇺🇳🇦🇷🇦🇺🇦🇹🇧🇪🇧🇷🇨🇦🇨🇱🇨🇳🇨🇴🇨🇿🇩🇰🇪🇬🇫🇮🇫🇷🇩🇪🇬🇷🇭🇰🇭🇺🇮🇳🇮🇩🇮🇪🇮🇱🇮🇹🇯🇵🇰🇷🇲🇽🇳🇱🇳🇿🇳🇴🇵🇰🇵🇪🇵🇭🇵🇱🇵🇹🇷🇴🇷🇺🇸🇦🇸🇬🇿🇦🇪🇸🇸🇪🇨🇭🇹🇼🇹🇭🇹🇷🇺🇦🇦🇪🇬🇧🇺🇸🇻🇳'],
];

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const splitEmoji = (text: string) => [...segmenter.segment(text)].map((s) => s.segment);

type Tab = 'emoji' | 'icon';

/** FlowyIconEmojiPicker (shared/icon_emoji_picker/flowy_icon_emoji_picker.dart), emoji + icon tabs. */
export function IconEmojiPicker({
  initialTab = 'emoji',
  onSelected,
}: {
  initialTab?: Tab;
  onSelected: (icon: SelectedIcon) => void;
}) {
  const { tr } = useTr();
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div style={{ width: 352, height: 372, display: 'flex', flexDirection: 'column', padding: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 36, paddingLeft: 4 }}>
        {(['emoji', 'icon'] as const).map((t) => (
          <div
            key={t}
            onMouseDown={() => setTab(t)}
            style={{
              padding: '0 12px',
              height: 36,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              borderBottom: `2px solid ${tab === t ? 'var(--cs-primary)' : 'transparent'}`,
              color: tab === t ? 'var(--text-color)' : 'var(--th-hint)',
              fontSize: 'calc(14px * var(--text-scale, 1))',
              fontWeight: 500,
              lineHeight: '16px',
            }}
          >
            {t === 'emoji' ? 'Emojis' : 'Icons'}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <FlowyButton
          useIntrinsicWidth
          margin="4px 6px"
          text={<FlowyText.regular color="var(--th-hint)">{tr('button.remove')}</FlowyText.regular>}
          onTap={() => onSelected({ ty: ViewIconTypePB.Emoji, value: '' })}
        />
      </div>
      <div style={{ height: 1, background: 'var(--th-divider)', margin: '0 4px' }} />
      {tab === 'emoji' ? <EmojiGrid onSelected={onSelected} /> : <IconGrid onSelected={onSelected} />}
    </div>
  );
}

function EmojiGrid({ onSelected }: { onSelected: (icon: SelectedIcon) => void }) {
  const categories = useMemo(() => EMOJI_CATEGORIES.map(([name, text]) => [name, splitEmoji(text)] as const), []);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 0' }}>
      {categories.map(([name, emojis]) => (
        <div key={name}>
          <FlowyText.regular fontSize={12} color="var(--th-hint)" style={{ padding: '6px 2px' }}>
            {name}
          </FlowyText.regular>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)' }}>
            {emojis.map((emoji, i) => (
              <FlowyHover
                key={`${emoji}-${i}`}
                borderRadius={8}
                onClick={() => onSelected({ ty: ViewIconTypePB.Emoji, value: emoji })}
                style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <EmojiText emoji={emoji} size={24} />
              </FlowyHover>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IconGrid({ onSelected }: { onSelected: (icon: SelectedIcon) => void }) {
  const groups = useIconGroups();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        name: g.name,
        icons: q ? g.icons.filter((i) => i.name.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q))) : g.icons,
      }))
      .filter((g) => g.icons.length > 0);
  }, [groups, query]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 8px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            border: '1px solid var(--cs-outline)',
            borderRadius: 8,
            padding: '0 8px',
          }}
        >
          <FlowySvg svg="search_s" size={16} color="var(--th-hint)" />
          <input
            autoFocus
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              marginLeft: 6,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-color)',
              fontSize: 'calc(14px * var(--text-scale, 1))',
            }}
          />
        </div>
      </div>
      {!groups ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={24} stroke={3} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
          {filtered.map((group) => (
            <div key={group.name}>
              <FlowyText.regular fontSize={12} color="var(--th-hint)" style={{ padding: '6px 2px', textTransform: 'capitalize' }}>
                {group.name.replace(/_/g, ' ')}
              </FlowyText.regular>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)' }}>
                {group.icons.map((icon) => (
                  <FlowyHover
                    key={icon.name}
                    borderRadius={8}
                    onClick={() =>
                      onSelected({
                        ty: ViewIconTypePB.Icon,
                        value: JSON.stringify({ groupName: group.name, iconName: icon.name }),
                      })
                    }
                    style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <SvgString svg={icon.content} size={20} />
                  </FlowyHover>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
