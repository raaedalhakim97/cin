import { View, Text, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from './ui'
import { radius, space, type } from '../theme'

// Dark chrome bar with the title centred, a hamburger on the left and help plus
// notifications on the right — the layout from the reference app. The bar is
// dark in both themes, which is what keeps the light content surfaces feeling
// framed rather than washed out.
export default function TopBar({ title, onMenu, notifications = 0, onNotifications, onHelp }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={{ backgroundColor: c.chrome, paddingTop: insets.top }}>
      <View
        style={{
          height: space(7),
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space(2),
        }}
      >
        <Pressable onPress={onMenu} hitSlop={12} style={{ width: space(4) }}>
          <Ionicons name="menu" size={26} color={c.chromeText} />
        </Pressable>

        <Text style={{ ...type.h2, color: c.chromeText, flex: 1, textAlign: 'center' }} numberOfLines={1}>
          {title}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), width: space(8), justifyContent: 'flex-end' }}>
          <Pressable onPress={onHelp} hitSlop={10}>
            <Ionicons name="help-circle-outline" size={23} color={c.chromeMuted} />
          </Pressable>

          <Pressable onPress={onNotifications} hitSlop={10} style={{ position: 'relative' }}>
            <Ionicons name="notifications-outline" size={23} color={c.chromeText} />
            {notifications > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -8,
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 4,
                  borderRadius: radius.pill,
                  backgroundColor: c.cyan,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.onCyan }}>
                  {notifications > 99 ? '99+' : notifications}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  )
}
