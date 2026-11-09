import { useMemo, useState, type ReactNode } from 'react';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';
import { useTr } from '@/i18n';
import { Search } from 'lucide-react';
import { floatingSurfaceClass, MenuLabel } from '@/components/app/menu-row';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  const removeButton = <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onSelected({ ty: ViewIconTypePB.Emoji, value: '' })}>{tr('button.remove')}</Button>;
  return (
    <Tabs className={`${floatingSurfaceClass} h-96 w-[22rem] gap-0 p-0`} value={tab} onValueChange={(value) => setTab(value as Tab)}>
      <TabsList variant="line" className="h-9 w-full justify-start rounded-none border-b px-2">
        {(['emoji', 'icon'] as const).map((t) => (
          <TabsTrigger key={t} value={t} className="flex-none" onMouseDown={() => setTab(t)}>{t === 'emoji' ? 'Emojis' : 'Icons'}</TabsTrigger>
        ))}
      </TabsList>
      <TabsContent key={tab} value={tab} className="flex min-h-0 flex-1 flex-col">
        {tab === 'emoji' ? <EmojiGrid onSelected={onSelected} removeButton={removeButton} /> : <IconGrid onSelected={onSelected} removeButton={removeButton} />}
      </TabsContent>
    </Tabs>
  );
}

function EmojiGrid({ onSelected, removeButton }: { onSelected: (icon: SelectedIcon) => void; removeButton: ReactNode }) {
  const categories = useMemo(() => EMOJI_CATEGORIES.map(([name, text]) => [name, splitEmoji(text)] as const), []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-2 pt-2">{removeButton}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {categories.map(([name, emojis]) => (
          <div key={name}>
            <MenuLabel className="sticky top-0 z-10 bg-popover px-2">
              {name}
            </MenuLabel>
            <div className="grid grid-cols-9 gap-0.5 p-2">
              {emojis.map((emoji, i) => (
                <button type="button"
                  key={`${emoji}-${i}`}
                  onClick={() => onSelected({ ty: ViewIconTypePB.Emoji, value: emoji })}
                  className="flex size-8 items-center justify-center rounded-md text-xl outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <EmojiText emoji={emoji} size={20} />
                </button>
              ))}
            </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function IconGrid({ onSelected, removeButton }: { onSelected: (icon: SelectedIcon) => void; removeButton: ReactNode }) {
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <InputGroup>
          <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
          <InputGroupInput autoFocus placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <InputGroupAddon align="inline-end">{removeButton}</InputGroupAddon>
        </InputGroup>
      </div>
      {!groups ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((group) => (
            <div key={group.name}>
              <MenuLabel className="sticky top-0 z-10 bg-popover px-2 capitalize">
                {group.name.replace(/_/g, ' ')}
              </MenuLabel>
              <div className="grid grid-cols-9 gap-0.5 p-2">
                {group.icons.map((icon) => (
                  <button type="button"
                    key={icon.name}
                    onClick={() =>
                      onSelected({
                        ty: ViewIconTypePB.Icon,
                        value: JSON.stringify({ groupName: group.name, iconName: icon.name }),
                      })
                    }
                    className="flex size-8 items-center justify-center rounded-md text-xl outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <SvgString svg={icon.content} size={20} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
