import './globals.css';

export const metadata = {
  title: 'SIMDULICH.VN API',
  description: 'Backend API cho SIMDULICH.VN',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
