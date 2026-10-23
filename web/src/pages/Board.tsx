import { CommentOutlined } from '@ant-design/icons';
import { CommentSection } from '../components/CommentSection';

export function BoardPage() {
  return (
    <>
      <div className="docs-hero">
        <div className="container">
          <h1>
            <CommentOutlined style={{ color: '#0078d4', marginRight: 10 }} />
            留言板
          </h1>
          <p>内网公共留言区：反馈问题、求资源、交流使用技巧。发表评论会自动展示你的内网 IPv4。</p>
        </div>
      </div>
      <div className="container section" style={{ maxWidth: 1160 }}>
        <CommentSection
          targetType="board"
          targetId={0}
          title="全部留言"
          description="文明留言，管理员会定期整理；可回复、可被置顶，回复最多两级。"
        />
      </div>
    </>
  );
}
