import './globals.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

export const metadata = {
  title: 'SIMDULICH.VN',
  description: 'Bay khắp thế giới, không cần đổi SIM',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
