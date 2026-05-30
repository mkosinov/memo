import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

export interface HamburgerMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

const menuItems = [
  { label: "Услуги", href: "#services" },
  { label: "Студии", href: "#studios" },
  { label: "Пленэр", href: "#plein-air" },
  { label: "Корпоративы", href: "#corporate" },
  { label: "Магазин", href: "#shop" },
  { label: "О нас", href: "#about" },
  { label: "Личный кабинет", href: "#account" },
];

export function HamburgerMenu({ isOpen, onClose }: HamburgerMenuProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          data-testid="menu-overlay"
          className="fixed inset-0 z-50 bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="absolute top-0 right-0 bottom-0 w-3/4 max-w-xs bg-white shadow-xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-4">
              <button
                type="button"
                onClick={onClose}
                className="text-[#555555] hover:text-[#1a1a1a] text-2xl leading-none transition"
                aria-label="Close menu"
              >
                &times;
              </button>
            </div>
            <nav className="px-6 py-4">
              <ul className="space-y-4">
                {menuItems.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="block text-lg text-[#1a1a1a] hover:text-[#004D56] transition py-2"
                      onClick={onClose}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default HamburgerMenu;
