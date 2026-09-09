import {ImageResponse} from 'next/og';
export const alt='Thursday Post — Australian Racing: News, People & Industry';
export const size={width:1200,height:630};
export const contentType='image/png';
export default function Image(){return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'center',background:'#f7f4eb',color:'#24241f',padding:'70px'}}><div style={{display:'flex',fontSize:20,letterSpacing:5,marginBottom:38}}>INDEPENDENT AUSTRALIAN RACING JOURNALISM</div><div style={{display:'flex',fontFamily:'serif',fontSize:97,fontWeight:900,letterSpacing:-5,borderTop:'3px solid #24241f',borderBottom:'3px solid #24241f',padding:'30px 0'}}>THURSDAY POST</div><div style={{display:'flex',fontFamily:'serif',fontSize:35,marginTop:36}}>News, People &amp; Industry</div></div>,size);}
