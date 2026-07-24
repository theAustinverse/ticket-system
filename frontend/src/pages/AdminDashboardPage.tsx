import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';

export function AdminDashboardPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
    }
  }, [token, navigate]);

  return (
    <div className="page">
      <h1>後台管理</h1>
      <div className="admin-menu">
        <Link to="/admin/users" className="admin-menu-card">
          <h2>使用者帳號管理</h2>
          <p className="hint">瀏覽所有註冊帳號、依體系篩選、勾選刪除</p>
        </Link>
        <Link to="/admin/orders" className="admin-menu-card">
          <h2>訂單管理</h2>
          <p className="hint">瀏覽所有訂單、依體系篩選、查看各體系訂票排名</p>
        </Link>
        <Link to="/admin/chat" className="admin-menu-card">
          <h2>心情便利貼管理</h2>
          <p className="hint">瀏覽使用者留言、刪除不當內容</p>
        </Link>
        <Link to="/admin/ai-image" className="admin-menu-card">
          <h2>AI 產圖工具</h2>
          <p className="hint">輸入描述文字，AI 生成背景/招牌等素材圖片並下載</p>
        </Link>
      </div>
    </div>
  );
}
